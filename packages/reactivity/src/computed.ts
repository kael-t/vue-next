import { effect, ReactiveEffect, effectStack } from './effect'
import { Ref, UnwrapRef } from './ref'
import { isFunction, NOOP } from '@vue/shared'

export interface ComputedRef<T> extends WritableComputedRef<T> {
  readonly value: UnwrapRef<T>
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = () => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

// 这个是computed是函数时的方法, 如果是方法的话, 返回值是ComputedRef
export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
// 这个是当computed是对象时的方法, 如果是对象的话, 返回值是WritableComputedOptions, 因为有可能有setter, writeable
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  // 如果getterOrOptions是function的话, 直接把这个function作为getter, setter提示错误或者设为空方法
  // 如果不是function的话, 就把getterOrOptions.get set分别作为getter和setter
  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 标识是否已经修改过但未求值
  let dirty = true
  let value: T

  // 因为是lazy=true, 所以这里并不会立即计算
  const runner = effect(getter, {
    // 延迟计算
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    // 标识为computed来确定触发时候的优先级
    computed: true,
    // 调度函数, 所有跟这个computed有关的依赖变更, 最后都会调用一次这个方法
    // 使得这个computed的dirty=true, 然后每次调用computed的getter时检测dirty
    // 一旦dirty为true, 则调用getter更新computed的值, computed的求值是惰性的, 跟vue2.x一致
    scheduler: () => {
      dirty = true
    }
  })
  return {
    _isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        // 这里调用runner, 实际上就是通过一系列调度后调用getter
        // 所以这个value其实是调用getter后的值
        value = runner()
        dirty = false
      }
      // When computed effects are accessed in a parent effect, the parent
      // should track all the dependencies the computed property has tracked.
      // This should also apply for chained computed properties.
      trackChildRun(runner)
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  }
}

function trackChildRun(childRunner: ReactiveEffect) {
  if (effectStack.length === 0) {
    return
  }
  // 获取父级effect
  const parentRunner = effectStack[effectStack.length - 1]
  // 遍历childRunner的依赖
  for (let i = 0; i < childRunner.deps.length; i++) {
    const dep = childRunner.deps[i]
    // 如果依赖中没有parentRunner的话, 就添加parentRunner依赖到依赖集中
    // 以便子的更新可以通知到父级effect
    // 这里可以建立上下3代之间的关系, 首先childRunner是当前处理的computed元素
    // 那么childRunner.deps就是computed观察的依赖, 也就是内部的变量
    // computed的parentRunner, 也就是依赖到computed的上层属性
    // 如果上层属性没有依赖computed所依赖的变量的话, 就给他们奖励关系(越过了computed, 建立了上层属性到computed内部变量的依赖)
    if (!dep.has(parentRunner)) {
      dep.add(parentRunner)
      parentRunner.deps.push(dep)
    }
  }
}
