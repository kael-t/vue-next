import { makeMap } from './makeMap'

export { makeMap }
export * from './patchFlags'
export * from './shapeFlags'
export * from './globalsWhitelist'
export * from './codeframe'
export * from './mockWarn'
export * from './normalizeProp'
export * from './domTagConfig'
export * from './domAttrConfig'
export * from './escapeHtml'
export * from './looseEqual'
export * from './toDisplayString'

// 定义不可改空对象
export const EMPTY_OBJ: { readonly [key: string]: any } = __DEV__
  ? Object.freeze({})
  : {}
// 定义空数组
export const EMPTY_ARR: [] = []

// 定义空函数
export const NOOP = () => {}

/**
 * Always return false.
 */
export const NO = () => false

// 判断key是否以'on'开头
const onRE = /^on[^a-z]/
export const isOn = (key: string) => onRE.test(key)

// 把b对象的属性赋值给a对象(浅拷贝)
export const extend = <T extends object, U extends object>(
  a: T,
  b: U
): T & U => {
  for (const key in b) {
    ;(a as any)[key] = b[key]
  }
  return a as any
}

// 移除数组元素方法
export const remove = <T>(arr: T[], el: T) => {
  const i = arr.indexOf(el)
  if (i > -1) {
    arr.splice(i, 1)
  }
}

// 对象的hasOwnProperty方法的别名
const hasOwnProperty = Object.prototype.hasOwnProperty
// 判断key是否为object实例上的属性
export const hasOwn = (
  val: object,
  key: string | symbol
): key is keyof typeof val => hasOwnProperty.call(val, key)

// 判断类型
export const isArray = Array.isArray
export const isFunction = (val: unknown): val is Function =>
  typeof val === 'function'
export const isString = (val: unknown): val is string => typeof val === 'string'
export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'
export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
  return isObject(val) && isFunction(val.then) && isFunction(val.catch)
}

// 用于判断复杂类型 object => '[object Object]'  array => '[object Array]'
export const objectToString = Object.prototype.toString
export const toTypeString = (value: unknown): string =>
  objectToString.call(value)

// 复杂对象的原始类型, 就是截取'[object Object]'后面表示类型的字符串
export const toRawType = (value: unknown): string => {
  return toTypeString(value).slice(8, -1)
}

// 是否为原生对象
export const isPlainObject = (val: unknown): val is object =>
  toTypeString(val) === '[object Object]'

// TODO: 干嘛用的
export const isReservedProp = /*#__PURE__*/ makeMap(
  'key,ref,' +
    'onVnodeBeforeMount,onVnodeMounted,' +
    'onVnodeBeforeUpdate,onVnodeUpdated,' +
    'onVnodeBeforeUnmount,onVnodeUnmounted'
)

const cacheStringFunction = <T extends (str: string) => string>(fn: T): T => {
  const cache: Record<string, string> = Object.create(null)
  return ((str: string) => {
    const hit = cache[str]
    return hit || (cache[str] = fn(str))
  }) as any
}

// 连字符转驼峰
const camelizeRE = /-(\w)/g
export const camelize = cacheStringFunction(
  (str: string): string => {
    return str.replace(camelizeRE, (_, c) => (c ? c.toUpperCase() : ''))
  }
)

// 驼峰转连字符 \B匹配非单次边界
const hyphenateRE = /\B([A-Z])/g
export const hyphenate = cacheStringFunction(
  (str: string): string => {
    return str.replace(hyphenateRE, '-$1').toLowerCase()
  }
)

// 首字母大写
export const capitalize = cacheStringFunction(
  (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
)

// compare whether a value has changed, accounting for NaN.
// 对比两个值是否有改变, NaN !== NaN的, 所以新旧值都是NaN会被当做没有变化
export const hasChanged = (value: any, oldValue: any): boolean =>
  value !== oldValue && (value === value || oldValue === oldValue)

export const invokeArrayFns = (fns: Function[], arg?: any) => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](arg)
  }
}

export const def = (obj: object, key: string | symbol, value: any) => {
  Object.defineProperty(obj, key, {
    configurable: true,
    value
  })
}

export const toNumber = (val: any): any => {
  const n = parseFloat(val)
  return isNaN(n) ? val : n
}
