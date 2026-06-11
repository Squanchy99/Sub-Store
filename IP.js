// QX 入口 → 落地 检测脚本（可用版）

async function getIPInfo(url) {
  try {
    let resp = await $task.fetch({ url })
    return JSON.parse(resp.body)
  } catch {
    return {}
  }
}

function getFlag(cc) {
  if (!cc) return '🏳️'
  return String.fromCodePoint(...cc.toUpperCase().split('').map(c => 127397 + c.charCodeAt()))
}

(async () => {

  let proxies = $resource.content ? JSON.parse($resource.content) : []

  let results = []

  for (let p of proxies) {

    let entry = await getIPInfo("http://ip-api.com/json")
    let exit = await getIPInfo("https://ipapi.co/json")

    let entryFlag = getFlag(entry.countryCode)
    let exitFlag = getFlag(exit.country_code)

    let entryISP = entry.isp || ''
    let exitISP = exit.org || ''

    p.tag = `${entryFlag} ${entryISP} → ${exitFlag} ${exitISP}`

    results.push(p)
  }

  $done({ content: JSON.stringify(results) })

})()