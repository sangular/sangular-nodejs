import { isPojoObject, isFunction } from '../util/is'

const TYPES = {
    $escape: {
        //     //     stringify: value => {
        //     //         $escape: value
        //     //     }
        isValidToStringify: value => false,
        isValidToParse: value => true
    },
    $delete: {
        isValidToStringify: value => value === undefined,
        isValidToParse: value => value === 0,
        stringify: value => ({ $delete: 0 })
    }
}

function isValidToEscape(object) {
    if (!isPojoObject(object)) return
    let type_name
    for (const key in object) {
        if (!TYPES.hasOwnProperty(key) || type_name !== undefined) {
            return
        }
        type_name = key
    }
    return TYPES[type_name].isValidToParse(object[type_name])
        ? type_name
        : undefined
}

function isValidToStringify(value) {
    for (const type_name in TYPES) {
        if (TYPES[type_name].isValidToStringify(value)) {
            return type_name
        }
    }
}

function stringify(object, replacer, space) {
    const escaped = new Map()
    return JSON.stringify(
        object,
        function(prop, value) {
            if (value !== object && !escaped.has(value)) {
                if (isValidToEscape(value) !== undefined) {
                    escaped.set(value, true)
                    value = { $escape: value }
                }
                const type_name = isValidToStringify(value)
                if (type_name !== undefined) {
                    value = TYPES[type_name].stringify(value)
                }
            }

            return isFunction(replacer)
                ? replacer.call(this, prop, value)
                : value
        },
        space
    )
}

const DJSON = { stringify, TYPES }

export default DJSON
