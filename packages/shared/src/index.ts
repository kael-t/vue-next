import { makeMap } from './makeMap'

export { makeMap }
export * from './patchFlags'
export * from './globalsWhitelist'
export * from './codeframe'
export * from './domTagConfig'

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
export const isOn = (key: string) => key[0] === 'o' && key[1] === 'n'

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

export function isPromise<T = any>(val: unknown): val is Promise<T> {
  return isObject(val) && isFunction(val.then) && isFunction(val.catch)
}

// 用于判断复杂类型 object => '[object Object]'  array => '[object Array]'
export const objectToString = Object.prototype.toString
export const toTypeString = (value: unknown): string =>
  objectToString.call(value)

// 复杂对象的原始类型, 就是截取'[object Object]'后面表示类型的字符串
export function toRawType(value: unknown): string {
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

// 连字符转驼峰
const camelizeRE = /-(\w)/g
export const camelize = (str: string): string => {
  return str.replace(camelizeRE, (_, c) => (c ? c.toUpperCase() : ''))
}

// 驼峰转连字符 \B匹配非单次边界
const hyphenateRE = /\B([A-Z])/g
export const hyphenate = (str: string): string => {
  return str.replace(hyphenateRE, '-$1').toLowerCase()
}

// 首字母大写
export const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// compare whether a value has changed, accounting for NaN.
// 对比两个值是否有改变, NaN !== NaN的
export const hasChanged = (value: any, oldValue: any): boolean =>
  value !== oldValue && (value === value || oldValue === oldValue)
