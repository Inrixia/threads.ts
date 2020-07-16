const path = require('path')
const { Parent } = require(path.join(__dirname, '../index.js'))


const childPath = path.join(__dirname, './lib/child.js')
const smolPath = path.join(__dirname, './lib/smol.js')

const child = new Parent(childPath)
const smol = new Parent(smolPath)

;(async () => {
	console.log(await child.getSmol(1))
})()