'use strict'

const { version, env } = require('process')
const { registerFont, loadImage } = require('canvas')
const Konva = require('konva')
const { log, error } = require('console')
const { writeFileSync } = require('fs')
const { tmpdir } = require('os')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const testing = env.NODE_ENV === 'testing' ?? false

const logs = []

const writeLog = (message) => {
  logs.push(message)
}

const responseWrapper = {
  success: (res, image) => {
    return res.send(image).status(200).headers({ 'Content-Type': 'image/png' })
  },
  error: (res, message, code = 400) => {
    logs.push(`ERROR: ${message}`)
    return res.json(logs).status(code)
  }
}

const loadImages = async (stage) => {
  stage.find('Image').forEach(async (node) => {
    const media = node.getAttr('media')
    let src = media?.urls?.original?.url ?? null
    if (src) {
      src = src.replace('https://nyc3.cdn.digitaloceanspaces.com', 'https://collateral-plus.nyc3.cdn.digitaloceanspaces.com')
      writeLog(`Loading image: ${src}`)
      const img = await loadImage(src).catch(e => error(e))
      // writeLog('Adding image to image node')
      node.image(img)
    }
  })
}

const loadFonts = async (stage) => {
  const cache = []
  stage.find('Text').forEach(async (node) => {
    // get family and style
    let fontFamily = node.fontFamily() ?? 'Arial'
    const fontStyle = node.fontStyle() ?? '400'
    fontFamily = fontFamily.replace('Source Sans Pro', 'Source Sans 3')

    // search google fonts api by family
    const params = new URLSearchParams({ key: process.env.GOOGLE_FONTS_API_KEY, family: fontFamily })
    const url = `https://www.googleapis.com/webfonts/v1/webfonts?${params.toString()}`
    writeLog(`Searching for google font: ${fontFamily}`)

    const fonts = await fetch(url).then((res) => {
      if (!res.ok) return {}
      return res.json()
    })

    const { items = [] } = fonts

    // could be not found or system font
    // could possibly have a legacy font family name or misspelling?
    if (!items.length) {
      writeLog(`Font not found! ${fontFamily} is system font or does not exist!`)
      return
    }

    // set the font config for use in the registerFont method below
    // get the key name to access the ttf url in the font.files array
    const font = items[0]
    const fontConfig = { family: fontFamily }
    const parts = fontStyle.split(' ')
    let fileKey = ''
    if (parts.length === 1) {
      fontConfig.weight = parts[0] === '400' ? 'regular' : parts[0]
      fileKey = fontConfig.weight
    }
    else {
      fontConfig.style = parts[0]
      fontConfig.weight = parts[1] === '400' ? '' : parts[1]
      fileKey = `${fontConfig.weight}italic`
    }

    writeLog(`fileKey: ${fileKey}`)
    // log(font.files)

    // get the url, and local file name - also the cach key
    const fileUrl = font.files[fileKey]

    const localFilename = `${fontFamily.replaceAll(' ', '-').toLowerCase()}-${fileKey}-${fileUrl.replace('https://fonts.gstatic.com/s/', '').replaceAll('/', '-')}`

    writeLog(`cacheKey: ${localFilename}`)

    if (cache.includes(localFilename)) {
      writeLog(`No need to load font ${fontFamily}. Exists in cache.`)
      return
    }

    // fetch the ttf
    const fontsPath = testing ? `${process.env.BASE_PATH}/fonts` : tmpdir()
    writeLog(`Downloading font from ${fileUrl}`)
    const ttf = await fetch(fileUrl).then(res => {
      if (!res.ok) {
        throw new Error(`Error downloading google font ${fileUrl}`)
      }
      return res.blob()
    })

    // save the file to local disk
    // wrapped in try in case the file exists
    const fontPath = `${fontsPath}/${localFilename}`
    try {
      writeLog(`writeFileSync: [${fontPath}]`)
      const arrayBuffer = await ttf.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      writeFileSync(fontPath, buffer)
    } catch (error) { }

    // registerFont: https://github.com/Automattic/node-canvas?tab=readme-ov-file#registerfont
    writeLog(`registerFont(${fontPath}, ${Object.keys(fontConfig).map(prop => `${prop}:${fontConfig[prop]}`).join(',')})`)
    registerFont(fontPath, fontConfig)

    writeLog(`Writing to cache ${localFilename}`)
    cache.push(localFilename)
  })
}

const fixText = async (stage) => {
  // Internally multiline text is treated as separate text entries for each line hence textArr[]
  // For non-system fonts, those lines can have clipped text, and smaller width sizes than listed in attrs
  // This is part of Konva internals ¯\_(ツ)_/¯
  stage.find('Text').forEach(layer => {
    const family = layer.fontFamily()
    layer.fontFamily(family)
    if (layer.textArr.length === 1) {
      layer.textArr[0].text = layer.attrs.text
    }
    layer.textArr.forEach(line => {
      line.width = layer.attrs.width * 2
    })
  })
}

const addBackgroundToJson = (json) => {

  const { attrs = null } = json
  if (!attrs) {
    writeLog('No need to add bg layer. !attrs')
    return json
  }

  const { background = null } = attrs
  if (!background) {
    writeLog('No need to add bg layer. !background')
    return json
  }

  json.children[0].children.unshift({
    className: 'Rect',
    attrs: {
      ...background,
      x: 0,
      y: 0,
      width: attrs.width,
      height: attrs.height,
    }
  })

  return json
}

export default async function handler(req, res) {

  const { json = {} } = req.query

  writeLog(`Node Version: ${version}`)
  writeLog(`Node Environment: ${Object.keys(env).map(k => `${k}:${env[k]}`).join('; ')}`)
  writeLog(`Konva Version: ${Konva.version}`)

  if (!Object.keys(json).length) {
    return responseWrapper.error(res, 'JSON is empty!', 400)
  }

  try {
    writeLog('Adding background layer to JSON')
    json = addBackgroundToJson(json)
    writeLog('... done adding background layer to JSON')

    writeLog('Creating konva stage with json...')
    const stage = Konva.Node.create(JSON.stringify(json))
    writeLog('... done creating konva stage with json')

    writeLog('Loading fonts...')
    await loadFonts(stage)
    writeLog(`... done loading fonts`)

    writeLog('Loading images...')
    await loadImages(stage)
    writeLog(`... done loading images`)

    await sleep(500)

    writeLog('Fix text ...')
    await fixText(stage)
    writeLog(`... done fixing text`)

    writeLog('Generating image...')
    const image = stage.toCanvas().toBuffer('image/png')
    writeLog('... done generating image')

    return responseWrapper.success(res, image)

  } catch (error) {
    return responseWrapper.error(res, 'Catch error', 401)
  }
}
