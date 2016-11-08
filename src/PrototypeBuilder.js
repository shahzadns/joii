/* Javascript Object Inheritance Implementation                ______  ________
 * (c) 2016 <harold@iedema.me>                             __ / / __ \/  _/  _/
 * Licensed under MIT.                                    / // / /_/ // /_/ /
 * ------------------------------------------------------ \___/\____/___/__*/

JOII = typeof (JOII) !== 'undefined' ? JOII : {};

JOII.InternalPropertyNames = ['__joii__', 'super', 'instanceOf', 'deserialize', 'serialize'];
JOII.InternalTypeNames     = [
    'undefined', 'object', 'boolean',
    'number'   , 'string', 'symbol',
    'function' , 'const'
];

/**
 * The PrototypeBuilder is responsible for creating a prototype of the
 * final 'class'- or 'interface'-type.
 *
 * Parameters can consist of one or more of the following:
 *      'extends'    : <class-type> Inherit a parent type
 *      'implements' : <array of interface-type>
 *
 * @param  {String}  name
 * @param  {Object}  parameters
 * @param  {Object}  body
 * @param  {Boolean} is_interface
 * @return {Object}
 */
JOII.PrototypeBuilder = function(name, parameters, body, is_interface) {


    // Create a clean prototype of the class body.
    var prototype = {},
        deep_copy = JOII.Compat.extend(true, {}, body);

    // Create the internal JOII-object.
    JOII.CreateProperty(prototype, '__joii__', {
        name            : name,
        parent          : undefined,
        metadata        : {},
        constants       : {},
        implementations : [name],
        is_abstract     : parameters.abstract === true,
        is_final        : parameters.final === true
    });

    // Apply traits / mix-ins
    if (typeof (parameters.uses) !== 'undefined') {
        var traits = JOII.Compat.flexibleArgumentToArray(parameters.uses);
        for (var t in traits) {
            deep_copy = JOII.Compat.extend(true, deep_copy, traits[t]);
        }
    }

    if (prototype.__joii__.is_abstract && prototype.__joii__.is_final) {
        throw 'A class cannot be both abstract and final simultaniously.';
    }

    // Iterate over properties from the deep_copy, get the metadata of the
    // property and move them in the prototype.
    for (var i in deep_copy) {
        if (deep_copy.hasOwnProperty(i) === false) continue;
        var meta = JOII.ParseClassProperty(i);

        if (typeof (deep_copy[i]) === 'function' || meta.parameters.length > 0 || (meta.name in prototype.__joii__.metadata && 'overloads' in prototype.__joii__.metadata[meta.name])) {
            if (typeof (deep_copy[i]) !== 'function') {
                if (meta.parameters.length > 0) {
                    throw 'Member ' + meta.name + ' specifies parameters, but it\'s value isn\'t a function.';
                } else {
                    throw 'Member ' + meta.name + ' overloads an existing function, but it\'s value isn\'t a function.';
                }
            }
            if (meta.name in prototype && typeof (prototype[meta.name]) !== 'function') {
                throw 'Member ' + meta.name + ' overloads an existing property, but the previous property isn\'t a function.';
            }

            JOII.AddFunctionToPrototype(prototype, meta, deep_copy[i]);

        } else if (meta.is_constant) {
            prototype.__joii__.constants[meta.name] = deep_copy[i];
            JOII.CreateProperty(prototype, meta.name, deep_copy[i], false);
            prototype.__joii__.metadata[meta.name] = meta;
        } else {
            prototype[meta.name] = deep_copy[i];
            prototype.__joii__.metadata[meta.name] = meta;
        }

        // Don't create getters and setters if we are an interface.
        if (is_interface === true) {
            continue;
        }
    }

    if (typeof (parameters.abstract) !== 'undefined') {
        prototype.__joii__.is_abstract = true;
        if (is_interface) {
            throw 'An interface cannot be declared abstract.';
        }
    }

    // Apply the parent prototype.
    if (typeof (parameters['extends']) !== 'undefined') {
        var parent = parameters['extends'];

        // If the given parent is a function, use its prototype.
        if (typeof (parent) === 'function') {
            parent = parent.prototype;
        }

        // Only Object-types can be used as a parent object.
        if (typeof (parent) !== 'object') {
            throw (is_interface ? 'An interface' : 'A class') + ' may only extend on functions or object-types.';
        }

        // Create a parent property in the prototype which contains a deep-
        // copy of the prototype of the given parent.
        prototype.__joii__.parent = JOII.Compat.extend(true, {}, parent);

        // If the parent is final, it cannot be extended upon.
        if (parent.__joii__.is_final === true) {
            throw 'Unable to extend on a final class.';
        }

        // Iterate over parent classes and apply the implementations for the instanceOf verifications.
        var current = prototype.__joii__.parent;
        while (typeof current !== 'undefined') {
            prototype.__joii__.implementations.push(current.__joii__.name);
            // Move to the next underlying class.
            current = current.__joii__.parent;
        }

        // Clone the constants of the parent into this one.
        prototype.__joii__.constants = JOII.Compat.extend(true, prototype.__joii__.constants, parent.__joii__.constants);

        // The __joii__ property is usually hidden and not enumerable, so we
        // need to re-create it ourselves.
        JOII.CreateProperty(prototype.__joii__.parent, '__joii__', (parent.__joii__));

        // Iterate over the properties of the parent object and apply the
        // contents in our own prototype where applicable.
        for (i in prototype.__joii__.parent) {
            // We're only interested in properties that really belong to
            // the object. So we'll skip any inherited things from the
            // native JavaScript's "Object".
            if (!prototype.__joii__.parent.hasOwnProperty(i)) {
                continue;
            }

            // If the property is an internal method, skip it.
            if (JOII.Compat.indexOf(JOII.InternalPropertyNames, i) !== -1) {
                continue;
            }

            var property      = prototype.__joii__.parent[i];
            var property_meta = prototype.__joii__.parent.__joii__.metadata[i];
            var proto_meta    = prototype.__joii__.metadata[i];

            if (typeof (proto_meta) === 'undefined') {
                proto_meta = prototype.__joii__.metadata[i] = JOII.Compat.extend(true, {}, property_meta);
                if ('overloads' in proto_meta) {
                    delete proto_meta.overloads;
                }
            }

            // If another property with the same name already exists within
            // our own prototype, skip its inherited implementation.
            if (typeof (prototype[i]) !== 'undefined' &&
                typeof (property_meta) === 'object' &&
                typeof (proto_meta) === 'object') {

                if (proto_meta.is_generated === false) {
                    // Check for visibility change.
                    if (property_meta.visibility !== proto_meta.visibility) {
                        throw 'Member "' + i + '" must be ' + property_meta.visibility + ' as defined in the parent ' + (is_interface ? 'interface' : 'class') + '.';
                    }

                    // Check final properties.
                    if (property_meta.is_final === true) {
                        throw 'Final member "' + i + '" cannot be overwritten.';
                    }

                    // Is the property read-only?
                    if (property_meta.is_read_only !== proto_meta.is_read_only) {
                        throw 'Member "' + i + '" must be read-only as defined in the parent ' + (is_interface ? 'interface' : 'class') + '.';
                    }

                    // Is the property nullable?
                    if (property_meta.is_nullable !== proto_meta.is_nullable) {
                        throw 'Member "' + i + '" must be nullable as defined in the parent ' + (is_interface ? 'interface' : 'class') + '.';
                    }

                }
                if (typeof (property) === 'function' || property_meta.parameters.length > 0 || 'overloads' in proto_meta || 'overloads' in property_meta) {
                    // if it's a function, we still want to proceed
                } else {
                    continue;
                }
            }

            if (typeof (property) === 'function' || property_meta.parameters.length > 0 || 'overloads' in proto_meta || 'overloads' in property_meta) {
                // if it's a function, we still want to proceed
            } else {
                // It's safe to apply non-function properties immediatly.
                if (typeof (property) !== 'function' || is_interface === true) {
                    prototype[i] = property;

                    // Create getters and setters for properties defined in a parent class,
                    // but only if they aren't declared in the child. (Fixes issue #10)
                    var gs = JOII.CreatePropertyGetterSetter(prototype, property_meta);
                    if (typeof prototype[gs.getter.name] === 'undefined' && typeof gs.getter.meta !== 'undefined') {
                        gs.getter.meta.is_generated = true;
                        prototype[gs.getter.name] = gs.getter.fn;
                        prototype.__joii__.metadata[gs.getter.name] = gs.getter.meta;
                    }
                    if (typeof prototype[gs.setter.name] === 'undefined' && typeof gs.setter.meta !== 'undefined') {
                        gs.setter.meta.is_generated = true;
                        prototype[gs.setter.name] = gs.setter.fn;
                        prototype.__joii__.metadata[gs.setter.name] = gs.setter.meta;
                    }
                    continue;
                }
            }

            // From this point on, the 'property' variable only contains
            // functions. This is where the funny business starts. Instead
            // of simply copying the 'function' into our own prototype,
            // we'll create our own function which calls the function from
            // the parent object. (Fixes issue #9)
            // The function "super" is implemented from the ClassBuilder.

            var generatedFn = Function('\
                var args = ["' + i + '"];\
                for (var i in arguments) { args.push(arguments[i]); }\
                return this[\'super\'].apply(this, args);\
            ');

            if (typeof (property) === 'function' || property_meta.parameters.length > 0 || 'overloads' in proto_meta || 'overloads' in property_meta) {
                if ('overloads' in property_meta && typeof (property_meta.overloads) === 'object' && property_meta.overloads.length > 1) {

                    var tmpMeta = JOII.Compat.extend(true, {}, property_meta);

                    // parent has multiple overloads specified. Loop through them, and apply each.
                    for (var idx = 0; idx < property_meta.overloads.length; idx++) {
                        tmpMeta.parameters = property_meta.overloads[idx].parameters;
                        tmpMeta.is_abstract = property_meta.overloads[idx].is_abstract;
                        JOII.AddFunctionToPrototype(prototype, tmpMeta, generatedFn, true);
                    }
                } else {
                    JOII.AddFunctionToPrototype(prototype, property_meta, generatedFn, true);
                }

            } else {
                prototype[i] = generatedFn;
            }
        }
    }

    // Create getters and setters for properties. We do this _after_ the
    // copying of the parent object because that prototype doesn't contain
    // the getter/setter methods yet. (Fixes issue #10)
    for (var i in deep_copy) {
        if (deep_copy.hasOwnProperty(i) === false) continue;
        var meta = JOII.ParseClassProperty(i);
        // Generate getters and setters if we're not dealing with anything
        // that is a function or declared private.
        if (typeof (prototype[meta.name]) !== 'function' &&
            meta.visibility !== 'private') {

            var gs = JOII.CreatePropertyGetterSetter(deep_copy, meta);
            prototype[gs.getter.name] = gs.getter.fn;
            prototype.__joii__.metadata[gs.getter.name] = gs.getter.meta;
            prototype[gs.setter.name] = gs.setter.fn;
            prototype.__joii__.metadata[gs.setter.name] = gs.setter.meta;
        }
    }



    if (is_interface !== true) {
        /**
         * Calls a method from the parent prototype (if it exists).
         *
         * @param  {String} method
         * @return {*}
         */
        prototype['super'] = function(method) {
            var args = Array.prototype.slice.call(arguments, 1),
                current_scope = this,
                original_prop = this.__joii__,
                call          = function(scope, method, args) {
                    if (typeof (scope) === 'undefined') {
                        throw new Error('Parent method "' + method + '" does not exist.');
                    }
                    if (typeof (scope.__joii__.parent) !== 'undefined' &&
                        typeof (scope.__joii__.parent[method]) === 'undefined') {
                        return call(scope.__joii__.parent, method, args);
                    }

                    var parent = scope.__joii__.parent;
                    if (typeof (scope.__joii__.parent) === 'undefined') {
                        if (typeof (scope.__api__.__joii__.parent) !== 'undefined') {
                            parent = scope.__api__.__joii__.parent;
                        } else {
                            throw new Error('Method "' + method + '" does not exist in the parent class. (called using \'super()\')');
                        }
                    }

                    var m = parent[method];
                    current_scope.__joii__ = parent.__joii__;
                    var r = m.apply(current_scope, args);
                    current_scope.__joii__ = original_prop;
                    return r;
                };

            return call(this, method, args);
        };

        /**
         * Tests if the prototype implements an interface of the given name.
         *
         * @param  {String} name
         * @return {Boolean}
         */
        prototype.instanceOf = function(name) {

            // Find the JOII scope of the given object.
            if (typeof (name) === 'function') {
                name = name.prototype.__joii__.name;
            } else if (typeof (name) === 'object') {
                name = name.__joii__.name;
            }

            // Match against defined interfaces implemented in the class.
            var interfaces = this.__joii__.getInterfaces();
            for (var i in interfaces) {
                if (interfaces.hasOwnProperty(i) === false) continue;
                if (interfaces[i].prototype.__joii__.name === name) {
                    return true;
                }
                if (JOII.Compat.indexOf(interfaces[i].prototype.__joii__.implementations, name) !== -1) {
                    return true;
                }
            }
            if (this.__joii__.name !== name) {
                // Attempt to validate by parent.
                if (typeof (this.__joii__.parent) !== 'undefined') {
                    // Temporarily bind instanceOf to the parent scope.
                    var cur_scope = this;
                    var par_scope = this.__joii__.parent;
                    JOII.Compat.Bind(par_scope.instanceOf, par_scope);
                    var result = par_scope.instanceOf(name);
                    // Restore the scope and return the result.
                    JOII.Compat.Bind(par_scope.instanceOf, cur_scope);
                    return result;
                }
                return false;
            }
            return true;
        };


    }

    return prototype;
};

/**
 * Parses a class property name and returns an object of property
 * metadata such as 'final', 'abstract', 'protected', etc.
 *
 * @param  {String} str
 * @return {Object}
 */
JOII.ParseClassProperty = function(str) {
    // Parse the given string and set some defaults.
    var functionParameters = (/\(.*\)/).exec(str.toString());
    if (functionParameters == null) {
        functionParameters = [];
    } else {
        functionParameters = functionParameters[0].match(/[^\(,\s\)]+/g);
    }
    if (typeof (functionParameters) != 'object' || functionParameters === null) {
        functionParameters = [];
    }

    var data = str.toString().replace(/\s?\(.*\)\s?|^\s+|\s+(?=\s)|\s+$/g, '').split(/\s/),
        name = data[data.length - 1],
        types = JOII.InternalTypeNames,
        explicit_serialize = false,
        metadata = {
            'name'          : name,
            'type'          : null,      // Allow all types by default.
            'visibility'    : 'public',  // Can be one of: public, protected, private.
            'is_abstract'   : false,     // Force implementation in child.
            'is_final'      : false,     // Disallow implementation in child.
            'is_nullable'   : false,     // Allow "null" or "undefined" in properties.
            'is_read_only'  : false,     // Don't generate a setter for the property.
            'is_constant'   : false,     // Is the property publicly accessible?
            'is_enum'       : false,     // Is the property an enumerator?
            'is_generated'  : false,     // Is the property generated?
            'is_joii_object': false,    // Does this represent a joii class/interface ?
            'serializable'  : false,      // Is the property serializable?
            'parameters'    : functionParameters
        }, i;


    // Remove the name from the list.
    data.pop();

    // If there are no flags set, simply return the defaults.
    if (data.length === 0) {
        return metadata;
    }

    // Make sure all property flags are lowercase. We don't use Array.map
    // for this because Internet Explorer 8 (and below) doesn't know it.
    for (i in data) {
        if (typeof (JOII.InterfaceRegistry[data[i]]) === 'undefined' &&
            typeof (JOII.ClassRegistry[data[i]]) === 'undefined') {
            data[i] = data[i].toString().toLowerCase();
        }
    }

    // Shorthand for validating other flags within the same declaration.
    // If args exists in data, msg is thrown.
    var metaHas = function(args, data, msg) {
        if (typeof (args) !== 'object') {
            args = [args];
        }

        for (var i in args) {
            if (args.hasOwnProperty(i) === false) continue;
            if (JOII.Compat.indexOf(data, args[i]) !== -1) {
                throw msg;
            }
        }
    };

    for (i in data) {
        switch (data[i]) {
            case 'public':
                metaHas('protected', data, 'Property "' + name + '" cannot be both public and protected at the same time.');
                metaHas('private', data, 'Property "' + name + '" cannot be both public and private at the same time.');
                metadata.visibility = 'public';
                if (!explicit_serialize) {
                    metadata.serializable = true;
                }
                break;
            case 'protected':
                metaHas('public', data, 'Property "' + name + '" cannot be both protected and public at the same time.');
                metaHas('private', data, 'Property "' + name + '" cannot be both protected and private at the same time.');
                metadata.visibility = 'protected';
                break;
            case 'private':
                metaHas('public', data, 'Property "' + name + '" cannot be both private and public at the same time.');
                metaHas('protected', data, 'Property "' + name + '" cannot be both private and protected at the same time.');
                metadata.visibility = 'private';
                break;
            case 'abstract':
                metaHas('final', data, 'Property "' + name + '" cannot be both abstract and final at the same time.');
                metadata.is_abstract = true;
                break;
            case 'final':
                metaHas('abstract', data, 'Property "' + name + '" cannot be both abstract and final at the same time.');
                metadata.is_final = true;
                break;
            case 'nullable':
                metadata.is_nullable = true;
                break;
            case 'read':
            case 'immutable':
                metadata.is_read_only = true;
                break;
            case 'serializable':
                metadata.serializable = true;
                explicit_serialize = true;
                break;
            case 'notserializable':
                metadata.serializable = false;
                explicit_serialize = true;
                break;
            case 'const':
                metaHas(['private', 'protected', 'public'], data, 'A constant cannot have visibility modifiers.');
                metaHas('final', data, 'A constant cannot be final.');
                metaHas('abstract', data, 'A constant cannot be abstract.');
                metaHas(['nullable', 'immutable', 'read'], data, 'A constant cannot be nullable or immutable.');
                metadata.is_constant = true;
                break;
            default:
                if (JOII.Compat.indexOf(types, data[i]) !== -1) {
                    if (metadata.type !== null) {
                        throw 'Property "' + name + '" has multiple type defintions.';
                    }
                    metadata.type = data[i];
                    break;
                }
                // Check for Interface-types
                if (typeof (JOII.InterfaceRegistry[data[i]]) !== 'undefined') {
                    metadata.is_joii_object = true;
                    metadata.type = JOII.InterfaceRegistry[data[i]].definition.__interface__.name;
                    break;
                }
                // Check for Class-types
                if (typeof (JOII.ClassRegistry[data[i]]) !== 'undefined') {
                    metadata.is_joii_object = true;
                    metadata.type = JOII.ClassRegistry[data[i]].prototype.__joii__.name;
                    break;
                }
                // Check for enumerators
                if (typeof (JOII.EnumRegistry[data[i]]) !== 'undefined') {
                    metadata.is_enum = true;
                    metadata.type    = data[i];
                    break;
                }

                throw 'Syntax error: unexpected "' + data[i] + '" in property declaration of "' + name + '".';
        }
    }

    return metadata;
};

JOII.CreatePropertyGetterSetter = function(deep_copy, meta) {
    "use strict";
    // If the meta type is boolean, prefix the getter with 'is'
    // rather than 'get'.
    var getter, getter_meta, getter_fn;
    if (meta.type === 'boolean') {
        if (JOII.CamelcaseName(meta.name).substr(0, 2) === 'Is') {
            getter = JOII.CamelcaseName(meta.name);
            getter = getter.substring(0, 1).toLowerCase() + getter.substring(1);
        } else {
            getter = 'is' + JOII.CamelcaseName(meta.name);
        }
    } else {
        getter = 'get' + JOII.CamelcaseName(meta.name);
    }
    var setter = 'set' + JOII.CamelcaseName(meta.name), setter_meta, setter_fn;

    // Create a getter
    if (typeof (deep_copy[getter]) === 'undefined') {
        getter_fn = new Function('return this["' + meta.name + '"];');
        getter_meta = JOII.ParseClassProperty(meta.visibility + ' function ' + getter);
        getter_meta.visibility = meta.visibility;
        getter_meta.is_abstract = meta.is_abstract;
        getter_meta.is_final = meta.is_final;
    }

    // Create a setter
    if (typeof (deep_copy[setter]) === 'undefined' && meta.is_read_only === false) {
        var nullable = meta.is_nullable, validator;

        // InstanceOf validator (in case of interfaces & classes)
        if (typeof (JOII.InterfaceRegistry[meta.type]) !== 'undefined' ||
            typeof (JOII.ClassRegistry[meta.type]) !== 'undefined') {
            validator = '\
                        if (JOII.Compat.findJOIIName(v) === \'' + meta.type + '\') {} else {\n\
                        if (v !== null && typeof (v.instanceOf) !== \'function\' || (typeof (v) === \'object\' && v !== null && typeof (v.instanceOf) === \'function\' && !v.instanceOf(\'' + meta.type + '\')) || v === null) {\n\
                            if ('+ nullable + ' === false || (' + nullable + ' === true && v !== null && typeof (v) !== "undefined")) {\n\
                                throw "'+ setter + ' expects an instance of ' + meta.type + ', " + (v === null ? "null" : typeof (v)) + " given.";\n\
                            }\n\
                        }};';
        } else {
            // Native type validator
            validator = '\
                        if (typeof (JOII.EnumRegistry[\'' + meta.type + '\']) !== \'undefined\') {\
                            var _e = JOII.EnumRegistry[\'' + meta.type + '\'];\
                            if (!_e.contains(v)) {\
                                throw "'+ setter + ': \'" + v + "\' is not a member of enum " + _e.getName() + ".";\
                            }\
                        } else {\
                            if (typeof (v) !== \'' + meta.type + '\') {\
                                if ('+ nullable + ' === false || (' + nullable + ' === true && v !== null && typeof (v) !== "undefined")) {\
                                    throw "'+ setter + ' expects ' + meta.type + ', " + typeof (v) + " given.";\
                                }\
                            };\
                        }';
        }
        setter_fn = new Function('v', (meta.type !== null ? validator : '') + 'this["' + meta.name + '"] = v; return this.__api__;');
        setter_meta = JOII.ParseClassProperty(meta.visibility + ' function ' + setter);
        setter_meta.visibility = meta.visibility;
        setter_meta.is_abstract = meta.is_abstract;
        setter_meta.is_final = meta.is_final;
    }

    return {
        'getter' : { name: getter, fn: getter_fn, meta: getter_meta },
        'setter' : { name: setter, fn: setter_fn, meta: setter_meta }
    };
};

/**
 * Creates a non-enumerable property in the given object.
 *
 * If the browser doesn't support Object.defineProperty, a regular
 * property is created instead. Please be aware that unit-tests using
 * deepEqual-assertions might fail on this using older browsers.
 *
 * @param {Object}  obj
 * @param {String}  name
 * @param {*}       val
 * @param {Boolean} writable
 */
JOII.CreateProperty = function(obj, name, val, writable) {
    try {
        if (typeof (Object.defineProperty) !== 'undefined') {
            Object.defineProperty(obj, name, {
                value        : val,
                enumerable   : (writable === false),
                configurable : (writable !== false),
                writable     : (writable !== false)
            });
        } else {
            obj[name] = val;
        }
    } catch (e) {
        obj[name] = val;
    }
};



/**
 * Adds a function to the prototype. 
 *
 * Meta.parameters should include the types in order to support overloading.
 *
 * @param {Object}   prototype
 * @param {Object}   meta
 * @param {Function} fn
 * @param {Boolean}  ignoreDuplicate
 */
JOII.AddFunctionToPrototype = function(prototype, meta, fn, ignoreDuplicate) {

    if (typeof (ignoreDuplicate) === 'undefined') {
        ignoreDuplicate = false;
    }
    if (typeof (prototype.__joii__.metadata[meta.name]) !== 'object') {
        prototype.__joii__.metadata[meta.name] = JOII.Compat.extend(true, {}, meta);
        prototype.__joii__.metadata[meta.name].overloads = [];
    }

    var proto_meta = prototype.__joii__.metadata[meta.name];

    if (typeof (proto_meta.overloads) !== 'object') {
        proto_meta.overloads = [];
    }

    if (proto_meta.visibility !== meta.visibility) {
        throw 'Member ' + meta.name + ': inconsistent visibility.';
    }

    proto_meta.is_abstract = false;

    for (var i = 0; i < meta.parameters.length - 1; i++) {
        if (meta.parameters[i] == '...') {
            throw 'Member ' + meta.name + ': Variadic parameter (...) must be the last in the function parameter list.';
        }
    }

    for (var idx = 0; idx < proto_meta.overloads.length; idx++) {
        var functionParametersMeta = proto_meta.overloads[idx];

        var foundAbstractThisLoop = false;
        if (functionParametersMeta.is_abstract) {
            foundAbstractThisLoop = true;
        }

        if (functionParametersMeta.parameters.length === meta.parameters.length) {
            // this signature has the same number of types as the new signature
            // check to see if the types are the same (duplicate signature)
            var different = false;

            for (var j = 0; j < functionParametersMeta.parameters.length; j++) {
                if (functionParametersMeta.parameters[j] != meta.parameters[j]) {
                    different = true;
                }
            }
            if (!different) {
                if (functionParametersMeta.is_abstract) {
                    proto_meta.overloads.splice(idx, 1); // remove the abstract version, since we're about to add a non-abstract
                    idx--; // adjust the idx for the changed array
                    foundAbstractThisLoop = false; // we're removing this, so don't count it for abstract check
                } else {
                    if (!ignoreDuplicate) {
                        throw 'Member ' + meta.name + '(' + meta.parameters.join(', ') + ') is defined twice.';
                    } else {
                        return false;
                    }
                }
            }
        }

        if (foundAbstractThisLoop) {
            proto_meta.is_abstract = true;
        }
    }

    var functionMeta = {
        fn: fn,
        parameters: meta.parameters,
        is_abstract: meta.is_abstract
    };

    prototype.__joii__.metadata[meta.name].overloads.push(functionMeta);

    if (functionMeta.is_abstract) {
        prototype.__joii__.metadata[meta.name].is_abstract = true;
    }
    // create function shim to validate the parameters, and allow overloading
    //if (typeof (prototype[meta.name]) !== 'function') { // this test was preventing it from overriding toString
    prototype[meta.name] = JOII.CreateFunctionShim(meta.name, prototype.__joii__.metadata[meta.name].overloads);
    //}

    return true;
};


/**
 * Creates a function detour which checks type parameters, then dispatches to the appropriate overloaded function.
 *
 * @param {String}   name
 * @param {Object}   overloads
 */
JOII.CreateFunctionShim = function(name, overloads) {

    return function() {

        // If there's only one function, and it has no parameters, we'll assume it's old-style to preserve backwards compatibility, so just pass the list of parameters
        if (overloads.length === 1 && overloads[0].parameters.length === 0) {
            return overloads[0].fn.apply(this, arguments);
        }

        var closestVariadic = null;
        var closestVariadicParameterCount = 0;

        for (var overloadIndex = 0; overloadIndex < overloads.length; overloadIndex++) {
            var func = overloads[overloadIndex];
            var parameters = func.parameters;

            var valid = true;

            // test exact matches
            if (parameters.length == arguments.length) {
                for (var i = 0; i < parameters.length; i++) {

                    if (!JOII.Compat.canTypeBeCastTo(arguments[i], parameters[i])) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    // found an overload that matches the inputs - call it
                    return func.fn.apply(this, arguments);
                }
            }

            if (parameters[parameters.length - 1] == '...') {
                // test for variadic
                valid = null;
                var variadicParameterCount = 0;
                for (var i = 0; i < parameters.length; i++) {

                    if (parameters[i] === '...') {
                        valid = true;
                    } else {
                        if (!JOII.Compat.canTypeBeCastTo(arguments[i], parameters[i])) {
                            valid = false;
                            break;
                        }
                        variadicParameterCount++;
                    }
                }

                if (valid) {

                    if (variadicParameterCount > closestVariadicParameterCount) {
                        closestVariadic = func;
                        closestVariadicParameterCount = variadicParameterCount;
                    }
                }
            }
        }

        if (closestVariadic != null) {
            // extract the variadic portion of the call to an array
            var args = []; // arguments.splice(closestVariadic.parameters.length -1);

            for (var i = closestVariadic.parameters.length - 1; i < arguments.length; i++) {
                args.push(arguments[i]);
            }

            arguments.length = closestVariadic.parameters.length;

            arguments[closestVariadic.parameters.length - 1] = args;


            // found an overload that matches the inputs - call it
            return closestVariadic.fn.apply(this, arguments);
        }

        // create a type list of the arguments for error handling purposes
        var parameterTypes = [];
        for (var i = 0; i < arguments.length; i++) {
            var JOIIName = JOII.Compat.findJOIIName(arguments[i]);
            if (!JOIIName) {
                JOIIName = typeof (arguments[i]);
            }
            parameterTypes.push(JOIIName === null ? typeof (arguments[i]) : JOIIName);
        }

        throw 'Couldn\'t find a function handler to match: ' + name + '(' + parameterTypes.join(', ') + ').';
    };
};


/**
 * Camelcase a name.
 *
 * @param  {String} input
 * @return {String}
 */
JOII.CamelcaseName = function(input) {
    input = input.toLowerCase().replace(/_(.)/g, function(match, group1) {
        return group1.toUpperCase();
    });
    return input.charAt(0).toUpperCase() + input.slice(1);
};
