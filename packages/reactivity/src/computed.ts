import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

// 这个是computed是函数时的方法, 如果是方法的话, 返回值是ComputedRef, 注意: computed返回的是Ref
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
  let computed: ComputedRef<T>

  // 因为是lazy=true, 所以这里并不会立即计算
  const runner = effect(getter, {
    // 延迟计算
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    // 标识为computed来确定触发时候的优先级
    // 详情可以看effect.ts, 在trigger的时候, 标识为computed的会先于普通的effect执行
    computed: true,
    // 调度函数, 所有跟这个computed有关的依赖变更, 都会调用一次这个方法
    // 使得这个computed的dirty=true, 然后每次调用computed的getter时检测dirty
    // 一旦dirty为true, 则调用getter更新computed的值, computed的求值是惰性的, 跟vue2.x一致
    /**
     * const times = ref(0)
     * count count = computed(() => times + 1)
     * times += 1
     * 每当times变化的时候就会调用scheduler是的count的dirty为true
     * 当取count值时就会调用computed的cb进行惰性求值
     */
    scheduler: () => {
      if (!dirty) {
        dirty = true
        trigger(computed, TriggerOpTypes.SET, 'value')
      }
    }
  })
  computed = {
    __v_isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        // 这里调用runner, 实际上就是通过一系列调度后调用getter
        // 所以这个value其实是调用getter后的值
        value = runner()
        dirty = false
      }
      track(computed, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  } as any
  return computed
}
