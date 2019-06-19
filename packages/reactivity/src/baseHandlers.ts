import { state, immutableState, toRaw } from './index'
import { OperationTypes } from './operations'
import { track, trigger } from './effect'
import { LOCKED } from './lock'
import { isObject } from '@vue/shared'
import { isValue } from './value'

const hasOwnProperty = Object.prototype.hasOwnProperty

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(value => typeof value === 'symbol')
)

function createGetter(isImmutable: boolean) {
  return function get(target: any, key: string | symbol, receiver: any) {
    const res = Reflect.get(target, key, receiver)
    if (typeof key === 'symbol' && builtInSymbols.has(key)) {
      return res
    }
    if (isValue(res)) {
      return res.value
    }
    track(target, OperationTypes.GET, key)
    return isObject(res)
      ? isImmutable
        ? // need to lazy access immutable and observable here to avoid
          // circular dependency
          immutableState(res)
        : state(res)
      : res
  }
}

function set(
  target: any,
  key: string | symbol,
  value: any,
  receiver: any
): boolean {
  value = toRaw(value)
  const hadKey = hasOwnProperty.call(target, key)
  const oldValue = target[key]
  if (isValue(oldValue)) {
    oldValue.value = value
    return true
  }
  const result = Reflect.set(target, key, value, receiver)
  // don't trigger if target is something up in the prototype chain of original
  if (target === toRaw(receiver)) {
    /* istanbul ignore else */
    if (__DEV__) {
      const extraInfo = { oldValue, newValue: value }
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key, extraInfo)
      } else if (value !== oldValue) {
        trigger(target, OperationTypes.SET, key, extraInfo)
      }
    } else {
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key)
      } else if (value !== oldValue) {
        trigger(target, OperationTypes.SET, key)
      }
    }
  }
  return result
}

function deleteProperty(target: any, key: string | symbol): boolean {
  const hadKey = hasOwnProperty.call(target, key)
  const oldValue = target[key]
  const result = Reflect.deleteProperty(target, key)
  if (hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.DELETE, key, { oldValue })
    } else {
      trigger(target, OperationTypes.DELETE, key)
    }
  }
  return result
}

function has(target: any, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, OperationTypes.HAS, key)
  return result
}

function ownKeys(target: any): (string | number | symbol)[] {
  track(target, OperationTypes.ITERATE)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<any> = {
  get: createGetter(false),
  set,
  deleteProperty,
  has,
  ownKeys
}

export const immutableHandlers: ProxyHandler<any> = {
  get: createGetter(true),

  set(target: any, key: string | symbol, value: any, receiver: any): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Set operation on key "${key as any}" failed: target is immutable.`,
          target
        )
      }
      return true
    } else {
      return set(target, key, value, receiver)
    }
  },

  deleteProperty(target: any, key: string | symbol): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Delete operation on key "${key as any}" failed: target is immutable.`,
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