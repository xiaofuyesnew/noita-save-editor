// 提交并发锁:包裹「应用/导入」类动作,in-flight 期间 submitting 为真,
// 重复点击(await 未完成 dirty 仍为真)被忽略,杜绝双击重复提交(重复法术/
// 道具、effperk 队头 double-POST 等)。
import { ref } from 'vue'

export function useSubmit() {
  const submitting = ref(false)

  /** 执行 fn;若已有一次在飞行中则直接忽略本次调用。 */
  async function run(fn) {
    if (submitting.value)
      return
    submitting.value = true
    try {
      return await fn()
    }
    finally {
      submitting.value = false
    }
  }

  return { submitting, run }
}
