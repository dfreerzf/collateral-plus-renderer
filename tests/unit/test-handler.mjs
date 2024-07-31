'use strict'

import { writeFileSync, readdir, unlink } from 'fs'
import { log, error } from 'console'
import fonts from '../json/fonts.json' with { type: "json" }
import images from '../json/images.json' with { type: "json" }
import highres from '../json/highres.json' with { type: "json" }
import simple from '../json/simple.json' with { type: "json" }
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { lambdaHandler } from '../../index.js'
import { expect } from 'chai'

process.env.GOOGLE_FONTS_API_KEY = ''

const __dirname = dirname(fileURLToPath(import.meta.url)).replace('/tests/unit', '')

const deleteFiles = (dir) => {
    readdir(`${__dirname}${dir}`, { withFileTypes: true }, (err, files) => {
        files.filter(({ name }) => name !== '.gitignore')
            .forEach(({ parentPath, name }) => unlink(`${parentPath}/${name}`, () => { }))
    })
}

const tests = [
    { json: fonts, label: 'Fonts' },
    // { json: highres, label: 'Highres' },
    { json: images, label: 'Images' },
    { json: simple, label: 'Simple' },
]

describe('Test for render', function () {

    // remove old images in test renderings
    deleteFiles('/tests/renders')

    // remove old fonts
    deleteFiles('/fonts')

    // run tests
    tests.forEach(async ({ json, label }) => {
        it(`Renders the ${label} JSON`, async () => {
            log({ [label]: json })
            const response = await lambdaHandler({ json })
            // console.log({ [label]: response })

            expect(response.statusCode).to.equal(200)

            if (response.statusCode === 200) {
                writeFileSync(`${__dirname}/tests/renders/${new Date().getTime()}.png`, Buffer.from(response.body))
            }
        })
    })
})
