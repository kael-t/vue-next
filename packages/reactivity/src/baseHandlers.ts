import { reactive, readonly, toRaw, ReactiveFlags } from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { track, trigger, ITERATE_KEY } from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  extend
} from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  // 获取Symbol的原型链上, 类型为Symbol的属性
  // 最后出来的是
  // 0: Symbol(Symbol.asyncIterator)
  // 1: Symbol(Symbol.hasInstance)
  // 2: Symbol(Symbol.isConcatSpreadable)
  // 3: Symbol(Symbol.iterator)
  // 4: Symbol(Symbol.match)
  // 5: Symbol(Symbol.matchAll)
  // 6: Symbol(Symbol.replace)
  // 7: Symbol(Symbol.search)
  // 8: Symbol(Symbol.species)
  // 9: Symbol(Symbol.split)
  // 10: Symbol(Symbol.toPrimitive)
  // 11: Symbol(Symbol.toStringTag)
  // 12: Symbol(Symbol.unscopables
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations: Record<string, Function> = {}
;['includes', 'indexOf', 'lastIndexOf'].forEach(key => {
  arrayInstrumentations[key] = function(...args: any[]): any {
    const arr = toRaw(this) as any
    // 对数组的每一项进行依赖收集
    for (let i = 0, l = (this as any).length; i < l; i++) {
      track(arr, TrackOpTypes.GET, i + '')
    }
    // we run the method using the original args first (which may be reactive)
    // 用原参数调用一次指定的方法, 如果返回的查找失败的话, 对参数进行toRaw后再调用指定方法一次
    // TODO: 考虑传入的参数已经是reactive或者ref的情况?
    // FIXME: 猜测: 假如数组中包含customRef并设置getter返回值为-1/false的情况, 则无论该Ref值为什么返回的都是是查找失败
    //             如[1, customRef(2), 3], 其中customRef(2)的getter被设置为return -1
    const res = arr[key](...args)
    if (res === -1 || res === false) {
      // 防止上面方法接收到的参数是Reactive的情况
      // 如果参数是Reactive的, 但数组上的不是, 可能会出现查找失败的问题
      // 如: [1,2,3,4].includes(Ref(4))
      // if that didn't work, run it again using raw values.
      return arr[key](...args.map(toRaw))
    } else {
      return res
    }
  }
})

// 创建getter方法, 通过闭包分别报错了isReadonly和shallow的值
// shallow的true和false表明是浅响应还是响应式, 浅响应的话, 深层对象改变不会被收集
// get: isReadonly->false  shallow->false
// shallowGet:  isReadonly->false  shallow->true
// readonlyGet:  isReadonly->true  shallow->false
// shallowReadonlyGet:  isReadonly->true  shallow->true
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    if (key === ReactiveFlags.IS_REACTIVE) {
      // __v_isReadonly为false的话则为响应式
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      // 返回__v_isReadonly的值
      return isReadonly
    } else if (
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? (target as any)[ReactiveFlags.READONLY]
          : (target as any)[ReactiveFlags.REACTIVE])
    ) {
      // 返回原值
      return target
    }

    // 如果取值对象是数组的话
    const targetIsArray = isArray(target)
    // 如果访问的是arrayInstrumentations的属性之一的则取arrayInstrumentations上的方法调用, 即采用劫持的方法
    if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
    // 其余直接去目标对象上的对应的值
    const res = Reflect.get(target, key, receiver)

    // 如果key是js内置的Symbols或者__proto__或者__v_isRef属性, 则取原生的, 也就是说vue不会收集builtInSymbols的依赖
    if (
      isSymbol(key)
        ? builtInSymbols.has(key)
        : key === `__proto__` || key === `__v_isRef`
    ) {
      return res
    }

    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    // 如果shallow为true, 返回取到的值(可能是响应式对象, 也可能不是)
    // 如果shallow为false: Ref对象的话返回原值, 否则返回响应式对象
    if (shallow) {
      return res
    }

    // 判断取到的值是否为Ref的
    if (isRef(res)) {
      // ref unwrapping, only for Objects, not for Arrays.
      // Ref在数组内的话返回Ref对象, 否则返回解包后的值
      return targetIsArray ? res : res.value
    }

    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 暂存旧值
    const oldValue = (target as any)[key]
    // 如果shallow为false时
    if (!shallow) {
      value = toRaw(value)
      // 目标对象不是数组, 旧值是Ref对象, 但新值不是Ref对象的, 直接更新旧值(原Ref对象)的value
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
      // 在shallow模式下, 无论是否为响应式对象, 对象的原值都会被修改
    }

    const hadKey = hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    // 在目标对象和receiver原对象为同一引用的时候才触发视图更新(解决特殊情况下重复触发视图更新的问题)
    // 也就是说, 修改到的不是对象上而是原型链上的值的话并不会trigger
    if (target === toRaw(receiver)) {
      // 目标对象上没有key, 触发add操作; 否则判断新旧值是否有变化, 有的话触发set操作
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

// 删除的trap
// TODO: 当target为数组的时候, splice也会执行deleteProperty, 当删除多项时, 会trigger多次, 是否已经做了优化?? 跟trigger的调度有关(看看对同一对象多次连续trigger是否已经优化了)
function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key) // 返回时Boolean值
  // 删除成功触发视图更新
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  // 返回删除成功还是失败的flag
  return result
}

// has trap
// 主要针对in操作符的代理方法
function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

// ownKeys trap
// 主要用于拦截 Object.getOwnPropertyNames/Object.getOwnPropertySymbols/Object.keys/for...in循环等等
function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  has,
  ownKeys,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

export const shallowReactiveHandlers: ProxyHandler<object> = extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ProxyHandler<object> = extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
