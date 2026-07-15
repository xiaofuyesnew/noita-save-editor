// API 薄封装:同源本地 REST,原生 fetch 足矣(无拦截器/重试/取消需求)。
// 统一错误对象:err.status(409 = 版本冲突,提示刷新)、err.data(服务端 payload)。

/**
 * 调用编辑器 API。
 * @param {string} path 以 / 开头的 API 路径(不含 /api 前缀)
 * @param {{ method?: string, body?: object }} [opts] body 存在时自动 JSON 序列化
 * @returns {Promise<any>} 服务端 JSON;非 2xx 抛 Error(message = 服务端 error 字段)
 */
export async function api(path, opts = {}) {
  const { method = 'GET', body } = opts
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || res.statusText)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}
