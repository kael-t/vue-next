import { reactive, readonly, toRaw } from './reactive'
import { OperationTypes } from './operations'
import { track, trigger } from './effect'
import { LOCKED } from './lock'
import { isObject, hasOwn, isSymbol, hasChanged } from '@vue/shared'
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

/**
 * 创建getter
 * @param isReadonly 是否为只读
 */
function createGetter(isReadonly: boolean, unwrap: boolean = true) {
  return function get(target: object, key: string | symbol, receiver: object) {
    // Reflect处理完以后会返回内层的对象
    const res = Reflect.get(target, key, receiver)
    // 如果key的类型是symbol且key为内置的symbol, 则不做其他处理, 直接返回res
    if (isSymbol(key) && builtInSymbols.has(key)) {
      return res
    }
    // 判断是否为Ref对象, 是的话直接返回它的value值
    // Ref已经是一个响应式对象了, 不需要再proxy
    if (unwrap && isRef(res)) {
      return res.value
    } else {
      // 收集target的依赖, 跟踪target的变化, 一旦target发生变化, target的Deps就会知道
      track(target, OperationTypes.GET, key)
    }
    // 如果内层对象是对象类型就判断是否是readonly的, 是readonly的话做readonly处理, 否则做reactive处理(对内层对象做递归处理)
    // 不是对象就直接返回原值
    return isObject(res)
      ? isReadonly
        ? // need to lazy access readonly and reactive here to avoid
          // circular dependency
          readonly(res)
        : reactive(res)
      : res
  }
}

function set(
  target: object,
  key: string | symbol,
  value: unknown,
  receiver: object
): boolean {
  // 获取原值
  value = toRaw(value)
  // 缓存旧值
  const oldValue = (target as any)[key]
  // 如果旧值是Ref类型的且新值不是ref类型的, 就把新值赋值给旧值的value属性
  if (isRef(oldValue) && !isRef(value)) {
    oldValue.value = value
    return true
  }
  // 判断target是否已经有当前的key
  // 通过判断key是否存在来区分这次操作是新增还是修改
  const hadKey = hasOwn(target, key)
  const result = Reflect.set(target, key, value, receiver)
  // don't trigger if target is something up in the prototype chain of original
  if (target === toRaw(receiver)) {
    /* istanbul ignore else */
    if (__DEV__) {
      const extraInfo = { oldValue, newValue: value }
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key, extraInfo)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, OperationTypes.SET, key, extraInfo)
      }
    } else {
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, OperationTypes.SET, key)
      }
    }
  }
  return result
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.DELETE, key, { oldValue })
    } else {
      trigger(target, OperationTypes.DELETE, key)
    }
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, OperationTypes.HAS, key)
  return result
}

function ownKeys(target: object): (string | number | symbol)[] {
  track(target, OperationTypes.ITERATE)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<object> = {
  get: createGetter(false),
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: createGetter(true),

  set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Set operation on key "${String(key)}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return set(target, key, value, receiver)
    }
  },

  deleteProperty(target: object, key: string | symbol): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Delete operation on key "${String(
            key
          )}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return deleteProperty(target, key)
    }
  },

  has,
  ownKeys
}

// props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const readonlyPropsHandlers: ProxyHandler<object> = {
  ...readonlyHandlers,
  get: createGetter(true, false)
}
