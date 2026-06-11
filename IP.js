/**
 * 节点信息(落地版)
 *
 * ⚠️ 本脚本用于检测节点【真实出口落地IP】, 而非入口IP
 * ⚠️ 原外部文档/群组链接境外无法访问，已移除引用
 * 功能：检测落地IP → 匹配国旗+国家 → 自动追加自增序号(1/2/3...)
 * 节点最终格式：【国旗 国家 序号】
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
 * - [api] 测落地的 API . 默认为: http://ip-api.com/json?lang=zh-CN
 * - [regex] 使用正则表达式从落地 API 响应(api)中取数据. 格式为 a:x;b:y
 * - [valid] 验证 api 请求是否合法. 默认: ProxyUtils.isIP('{{api.ip || api.query}}')
 * - [uniq_key] 设置缓存唯一键名包含的节点数据字段名匹配正则. 默认为 ^server$
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
  let utils
  function isIPv4(ip) {
  return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip)
}

function isIPv6(ip) {
  return /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::)$/.test(ip) ||
         /^(([0-9a-fA-F]{1,4}:){1,7}:|:([0-9a-fA-F]{1,4}:){1,7})$/.test(ip)
}

function isIP(ip) {
  return isIPv4(ip) || isIPv6(ip)
}

  // ========== 国旗+国家+国家代码 映射表（可自行扩展） ==========
  const countryFlagMap = {
    US: { flag: "🇺🇸", name: "美国" },
    SG: { flag: "🇸🇬", name: "新加坡" },
    JP: { flag: "🇯🇵", name: "日本" },
    KR: { flag: "🇰🇷", name: "韩国" },
    TW: { flag: "🇹🇼", name: "中国台湾" },
    HK: { flag: "🇭🇰", name: "中国香港" },
    GB: { flag: "🇬🇧", name: "英国" },
    DE: { flag: "🇩🇪", name: "德国" },
    FR: { flag: "🇫🇷", name: "法国" },
    AU: { flag: "🇦🇺", name: "澳大利亚" },
    CA: { flag: "🇨🇦", name: "加拿大" },
    TH: { flag: "🇹🇭", name: "泰国" },
    VN: { flag: "🇻🇳", name: "越南" }
  }
  // 全局节点序号，从 1 开始自增
  let nodeIndex = 1

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
    valid = $arguments.valid || `"{{api.countryCode || api.aso}}".length > 0`
  }

  const disableFailedCache = $arguments.disable_failed_cache || $arguments.ignore_failed_error
  const remove_failed = $arguments.remove_failed
  const entranceEnabled = $arguments.entrance
  const cacheEnabled = $arguments.cache
  const uniq_key = $arguments.uniq_key || '^server$'
  const cache = scriptResourceCache
  const method = $arguments.method || 'get'

  // 替换为国内可正常访问的IP查询接口
  const url = $arguments.api || `http://ip-api.com/json?lang=zh-CN`
  const concurrency = parseInt($arguments.concurrency || 10)

  await executeAsyncTasks(
    proxies.map(proxy => () => check(proxy)),
    { concurrency }
  )

  if (remove_failed) {
    proxies = proxies.filter(p => p._entrance)
  }

  if (!entranceEnabled) {
    proxies.forEach(p => delete p._entrance)
  }

  return proxies

  // 核心检测 & 重命名逻辑
  async function check(proxy) {
    const currentNum = nodeIndex++
    const id = cacheEnabled
      ? `outbound:${url}:${regex}:${internal}:${JSON.stringify(
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
          setNodeName(proxy, cached.api, currentNum)
          proxy._entrance = cached.api
          return
        } else if (disableFailedCache) {
          $.info(`[${proxy.name}] 不使用失败缓存`)
        } else {
          return
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
          setNodeName(proxy, api, currentNum)
          proxy._entrance = api
          if (cacheEnabled) cache.set(id, { api })
        } else {
          proxy.name = `🌐 未知地区 ${currentNum}`
          if (cacheEnabled) cache.set(id, {})
        }
      } else {
        // 通过当前节点代理请求，获取真实落地IP信息
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

        if (status === 200 && eval(formatter({ api, format: valid, regex }))) {
          setNodeName(proxy, api, currentNum)
          proxy._entrance = api
          if (cacheEnabled) cache.set(id, { api })
        } else {
          proxy.name = `🌐 未知地区 ${currentNum}`
          if (cacheEnabled) cache.set(id, {})
        }
      }
    } catch (e) {
      $.error(`[${proxy.name}] 落地IP检测失败: ${e.message ?? e}`)
      proxy.name = `🌐 未知地区 ${currentNum}`
      if (cacheEnabled) cache.set(id, {})
    }
  }

  // 根据国家代码匹配国旗+国家，拼接最终名称：国旗 国家 序号
  function setNodeName(proxy, api, num) {
    const countryCode = (api.countryCode || '').toUpperCase()
    const match = countryFlagMap[countryCode]
    if (match) {
      proxy.name = `${match.flag} ${match.name} ${num}`
    } else {
      proxy.name = `🌐 未知地区 ${num}`
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
