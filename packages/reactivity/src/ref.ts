import { track, trigger } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { isObject, hasChanged } from '@vue/shared'
import { reactive, isProxy, toRaw } from './reactive'
import { ComputedRef } from './computed'
import { CollectionTypes } from './collectionHandlers'

declare const RefSymbol: unique symbol

// 定义Ref接口
export interface Ref<T = any> {
  /**
   * Type differentiator only.
   * We need this to be in public d.ts but don't want it to show up in IDE
   * autocomplete, so we use a private Symbol instead.
   */
  [RefSymbol]: true
  value: T
}

export type ToRefs<T = any> = { [K in keyof T]: Ref<T[K]> }

// 把对象转换成proxy base的响应式对象, 不是对象返回原值
const convert = <T extends unknown>(val: T): T =>
  isObject(val) ? reactive(val) : val

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
// 判断是否为Ref的实例, 其实就是查看对象的refSymbol是否为true
export function isRef(r: any): r is Ref {
  return r ? r.__v_isRef === true : false
}

// TODO: ref和shallowRef的区别???
export function ref<T extends object>(
  value: T
): T extends Ref ? T : Ref<UnwrapRef<T>>
export function ref<T>(value: T): Ref<UnwrapRef<T>>
export function ref<T = any>(): Ref<T | undefined>
export function ref(value?: unknown) {
  return createRef(value)
}

// 创建一个Ref，但是只追踪value属性，不会追踪嵌套属性的value属性
export function shallowRef<T>(value: T): T extends Ref ? T : Ref<T>
export function shallowRef<T = any>(): Ref<T | undefined>
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

function createRef(rawValue: unknown, shallow = false) {
  // 判断是否已经是ref类型了, 是的话直接返回
  if (isRef(rawValue)) {
    return rawValue
  }
  // 如果shallow为false, 把原对象转换为响应式对象
  let value = shallow ? rawValue : convert(rawValue)
  // 返回一个Ref实例
  // 包含一个refSymbol属性, 标识为ref的实例
  // 包含一个value属性, 可以存取
  const r = {
    __v_isRef: true,
    get value() {
      // 依赖收集
      track(r, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newVal) {
      // 新旧值都没变化的话不执行setter
      if (hasChanged(toRaw(newVal), rawValue)) {
        rawValue = newVal
        value = shallow ? newVal : convert(newVal)
        trigger(
          r,
          TriggerOpTypes.SET,
          'value',
          __DEV__ ? { newValue: newVal } : void 0
        )
      }
    }
  }
  return r
}

// 强制触发数据变更, 可以配合shallowRef使用, shallowRef深层的修改不会触发视图变更, 可以通过triggerRef强制触发
export function triggerRef(ref: Ref) {
  trigger(
    ref,
    TriggerOpTypes.SET,
    'value',
    __DEV__ ? { newValue: ref.value } : void 0
  )
}

// 解开ref的包裹, 返回原值
export function unref<T>(ref: T): T extends Ref<infer V> ? V : T {
  return isRef(ref) ? (ref.value as any) : ref
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T
  set: (value: T) => void
}

// 创建自定义依赖项, 开发者可以自己定义触发监听和更新的逻辑, 比如说追踪的变量修改后2s才触发更新
export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  const { get, set } = factory(
    () => track(r, TrackOpTypes.GET, 'value'),
    () => trigger(r, TriggerOpTypes.SET, 'value')
  )
  const r = {
    __v_isRef: true,
    get value() {
      return get()
    },
    set value(v) {
      set(v)
    }
  }
  return r as any
}

// toRefs接受一个响应式复杂对象, 对对象下的值进行深度监听
export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (__DEV__ && !isProxy(object)) {
    console.warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = {}
  for (const key in object) {
    ret[key] = toRef(object, key)
  }
  return ret
}

// 这里的getter和setter不需要调用track和trigger是因为object已经是响应式对象
// 也就是给他直接赋值就会触发object的getter和setter, 然后触发track和trigger
export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): Ref<T[K]> {
  return {
    __v_isRef: true,
    get value(): any {
      return object[key]
    },
    set value(newVal) {
      object[key] = newVal
    }
  } as any
}

// corner case when use narrows type
// Ex. type RelativePath = string & { __brand: unknown }
// RelativePath extends object -> true
type BaseTypes = string | number | boolean

/**
 * This is a special exported interface for other packages to declare
 * additional types that should bail out for ref unwrapping. For example
 * \@vue/runtime-dom can declare it like so in its d.ts:
 *
 * ``` ts
 * declare module '@vue/reactivity' {
 *   export interface RefUnwrapBailTypes {
 *     runtimeDOMBailTypes: Node | Window
 *   }
 * }
 * ```
 *
 * Note that api-extractor somehow refuses to include `decalre module`
 * augmentations in its generated d.ts, so we have to manually append them
 * to the final generated d.ts in our build process.
 */
export interface RefUnwrapBailTypes {}

export type UnwrapRef<T> = T extends ComputedRef<infer V>
  ? UnwrapRefSimple<V>
  : T extends Ref<infer V> ? UnwrapRefSimple<V> : UnwrapRefSimple<T>

type UnwrapRefSimple<T> = T extends
  | Function
  | CollectionTypes
  | BaseTypes
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  ? T
  : T extends Array<any> ? T : T extends object ? UnwrappedObject<T> : T

// Extract all known symbols from an object
// when unwrapping Object the symbols are not `in keyof`, this should cover all the
// known symbols
type SymbolExtract<T> = (T extends { [Symbol.asyncIterator]: infer V }
  ? { [Symbol.asyncIterator]: V }
  : {}) &
  (T extends { [Symbol.hasInstance]: infer V }
    ? { [Symbol.hasInstance]: V }
    : {}) &
  (T extends { [Symbol.isConcatSpreadable]: infer V }
    ? { [Symbol.isConcatSpreadable]: V }
    : {}) &
  (T extends { [Symbol.iterator]: infer V } ? { [Symbol.iterator]: V } : {}) &
  (T extends { [Symbol.match]: infer V } ? { [Symbol.match]: V } : {}) &
  (T extends { [Symbol.matchAll]: infer V } ? { [Symbol.matchAll]: V } : {}) &
  (T extends { [Symbol.replace]: infer V } ? { [Symbol.replace]: V } : {}) &
  (T extends { [Symbol.search]: infer V } ? { [Symbol.search]: V } : {}) &
  (T extends { [Symbol.species]: infer V } ? { [Symbol.species]: V } : {}) &
  (T extends { [Symbol.split]: infer V } ? { [Symbol.split]: V } : {}) &
  (T extends { [Symbol.toPrimitive]: infer V }
    ? { [Symbol.toPrimitive]: V }
    : {}) &
  (T extends { [Symbol.toStringTag]: infer V }
    ? { [Symbol.toStringTag]: V }
    : {}) &
  (T extends { [Symbol.unscopables]: infer V }
    ? { [Symbol.unscopables]: V }
    : {})

type UnwrappedObject<T> = { [P in keyof T]: UnwrapRef<T[P]> } & SymbolExtract<T>
