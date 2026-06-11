/**
 * 节点信息(落地版)
 *
 * ⚠️ 本脚本用于检测节点【真实出口落地IP】, 而非入口IP
 *
 * 查看说明: https://t.me/zhetengsha/1269
 *
 * 入口版脚本请查看: https://t.me/zhetengsha/1358
 *
 * 欢迎加入 Telegram 群组 https://t.me/zhetengsha
 *
 * 参数
 * - [retries] 重试次数 默认 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认 1000
 * - [concurrency] 并发数 默认 10
 * - [internal] 使用内部方法获取 IP 信息. 默认 false
 *              支持以下几种运行环境:
 *              1. Surge/Loon(build >= 692) 等有 $utils.ipaso 和 $utils.geoip API 的 App
 *              2. Node.js 版 Sub-Store, 设置环境变量 SUB_STORE_MMDB_COUNTRY_PATH 和 SUB_STORE_MMDB_ASN_PATH, 或 传入 mmdb_country_path 和 mmdb_asn_path 参数(分别为 MaxMind GeoLite2 Country 和 GeoLite2 ASN 数据库 的路径)
 *              数据来自 GeoIP 数据库
 * - [method] 请求方法. 默认 get
 * - [timeout] 请求超时(单位: 毫秒) 默认 5000
 * - [api] 测落地的 API . 默认为: https://api.ipify.org/?format=json
 * - [format] 自定义格式, 从 节点(proxy) 和 落地(api)中取数据. 默认为: {{api.country}} {{api.isp}} - {{proxy.name}}
 *            当使用 internal 时, 默认为 {{api.countryCode}} {{api.aso}} - {{proxy.name}}
 * - [regex] 使用正则表达式从落地 API 响应(api)中取数据. 格式为 a:x;b:y 此时将使用正则表达式 x 和 y 来从 api 中取数据, 赋值给 a 和 b. 然后可在 format 中使用 {{api.a}} 和 {{api.b}}
 * - [valid] 验证 api 请求是否合法. 默认: ProxyUtils.isIP('{{api.ip || api.query}}')
 *           当使用 internal 时, 默认为 "{{api.countryCode || api.aso}}".length > 0
 * - [uniq_key] 设置缓存唯一键名包含的节点数据字段名匹配正则. 默认为 ^server$ 即服务器地址相同的节点共享缓存
 * - [entrance] 在节点上附加 _entrance 字段(API 响应数据), 默认不附加
 * - [remove_failed] 移除失败的节点. 默认不移除.
 * - [mmdb_country_path] 见 internal
 * - [mmdb_asn_path] 见 internal
 * - [cache] 使用缓存, 默认不使用缓存
 * - [disable_failed_cache/ignore_failed_error] 禁用失败缓存. 即不缓存失败结果
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore
  const { isNode } = $.env
  const internal = $arguments.internal
  const mmdb_country_path = $arguments.mmdb_country_path
  const mmdb_asn_path = $arguments.mmdb_asn_path
  const regex = $arguments.regex
  let valid = $arguments.valid || `ProxyUtils.isIP('{{api.ip || api.query}}')`
  let format = $arguments.format || `{{api.country}} {{api.isp}} - {{proxy.name}}`
  let utils

  if (internal) {
    if (isNode) {
      utils = new ProxyUtils.MMDB({ country: mmdb_country_path, asn: mmdb_asn_path })
      $.info(
        `[MMDB] GeoLite2 Country 数据库文件路径: ${mmdb_country_path || eval('process.env.SUB_STORE_MMDB_ASN_PATH')}`
      )
      $.info(`[MMDB] GeoLite2 ASN 数据库文件路径: ${mmdb_asn_path || eval('process.env.SUB_STORE_MMDB_COUNTRY_PATH')}`)
    } else {
      if (typeof $utils === 'undefined' || typeof $utils.geoip === 'undefined' || typeof $utils.ipaso === 'undefined') {
        $.error(`目前仅支持 Surge/Loon(build >= 692) 等有 $utils.ipaso 和 $utils.geoip API 的 App`)
        throw new Error('不支持使用内部方法获取 IP 信息, 请查看日志')
      }
      utils = $utils
    }
    format = $arguments.format || `{{api.countryCode}} {{api.aso}} - {{proxy.name}}`
    valid = $arguments.valid || `"{{api.countryCode || api.aso}}".length > 0`
  }

  const disableFailedCache = $arguments.disable_failed_cache || $arguments.ignore_failed_error
  const remove_failed = $arguments.remove_failed
  const entranceEnabled = $arguments.entrance
  const cacheEnabled = $arguments.cache
  const uniq_key = $arguments.uniq_key || '^server$'
  const cache = scriptResourceCache
  const method = $arguments.method || 'get'

  // ===================== 落地IP检测专用 API =====================
  const url = $arguments.api || `https://api.ipify.org/?format=json`

  const concurrency = parseInt($arguments.concurrency || 10)
  await executeAsyncTasks(
    proxies.map(proxy => () => check(proxy)),
    { concurrency }
  )

  if (remove_failed) {
    proxies = proxies.filter(p => {
      if (remove_failed && !p._entrance) {
        return false
      }
      return true
    })
  }

  if (!entranceEnabled) {
    proxies = proxies.map(p => {
      delete p._entrance
      return p
    })
  }

  return proxies

  // ===================== 核心：通过节点请求落地IP =====================
  async function check(proxy) {
    const id = cacheEnabled
      ? `outbound:${url}:${format}:${regex}:${internal}:${JSON.stringify(
          Object.fromEntries(
            Object.entries(proxy).filter(([key]) => {
              const re = new RegExp(uniq_key)
              return re.test(key)
            })
          )
        )}`
      : undefined

    try {
      const cached = cache.get(id)
      if (cacheEnabled && cached) {
        if (cached.api) {
          $.info(`[${proxy.name}] 使用成功缓存`)
          proxy.name = formatter({ proxy, api: cached.api, format, regex })
          proxy._entrance = cached.api
          return
        } else {
          if (disableFailedCache) {
            $.info(`[${proxy.name}] 不使用失败缓存`)
          } else {
            return
          }
        }
      }

      const startedAt = Date.now()
      let api = {}

      if (internal) {
        api = {
          countryCode: utils.geoip(proxy.server) || '',
          aso: utils.ipaso(proxy.server) || '',
        }
        if ((api.countryCode || api.aso) && eval(formatter({ api, format: valid, regex }))) {
          proxy.name = formatter({ proxy, api, format, regex })
          proxy._entrance = api
          if (cacheEnabled) cache.set(id, { api })
        } else {
          if (cacheEnabled) cache.set(id, {})
        }
      } else {
        // ===================== 通过代理请求落地IP =====================
        const res = await $.http[method]({
          url: formatter({ proxy, format: url }),
          proxy: proxy,
          timeout: parseFloat($arguments.timeout || 5000),
        })

        api = String(res.body)
        try { api = JSON.parse(api) } catch (e) {}

        const status = parseInt(res.status || 200)
        const latency = Date.now() - startedAt

        $.info(`[${proxy.name}] 落地IP状态: ${status}, 耗时: ${latency}ms`)

        if (status == 200 && eval(formatter({ api, format: valid, regex }))) {
          proxy.name = formatter({ proxy, api, format, regex })
          proxy._entrance = api
          if (cacheEnabled) cache.set(id, { api })
        } else {
          if (cacheEnabled) cache.set(id, {})
        }
      }
    } catch (e) {
      $.error(`[${proxy.name}] 落地IP检测失败: ${e.message ?? e}`)
      if (cacheEnabled) cache.set(id, {})
    }
  }

  function lodash_get(source, path, defaultValue = undefined) {
    const paths = path.replace(/\[(\d+)\]/g, '.$1').split('.')
    let result = source
    for (const p of paths) {
      result = Object(result)[p]
      if (result === undefined) return defaultValue
    }
    return result
  }

  function formatter({ proxy = {}, api = {}, format = '', regex = '' }) {
    if (regex) {
      const regexPairs = regex.split(/\s*;\s*/g).filter(Boolean)
      const extracted = {}
      for (const pair of regexPairs) {
        const [key, pattern] = pair.split(/\s*:\s*/g).map(s => s.trim())
        if (key && pattern) {
          try {
            const reg = new RegExp(pattern)
            extracted[key] = (typeof api === 'string' ? api : JSON.stringify(api)).match(reg)?.[1]?.trim()
          } catch (e) {
            $.error(`正则表达式解析错误: ${e.message}`)
          }
        }
      }
      api = { ...api, ...extracted }
    }

    let f = format.replace(/\{\{(.*?)\}\}/g, '${$1}')
    return eval(`\`${f}\``)
  }

  function executeAsyncTasks(tasks, { wrap, result, concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0
        const results = []
        let index = 0

        function executeNextTask() {
          while (index < tasks.length && running < concurrency) {
            const taskIndex = index++
            const currentTask = tasks[taskIndex]
            running++

            currentTask()
              .then(data => { if (result) results[taskIndex] = wrap ? { data } : data })
              .catch(error => { if (result) results[taskIndex] = wrap ? { error } : error })
              .finally(() => { running--; executeNextTask() })
          }
          if (running === 0) resolve(result ? results : undefined)
        }

        await executeNextTask()
      } catch (e) {
        reject(e)
      }
    })
  }
}