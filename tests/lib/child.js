const path = require('path')

const add1 = async num => num+1
const add1Deep = async num => {
	const { Parent } = require(path.join(__dirname, '../../index.js'))
	const subChild = new Parent(path.join(__dirname, './child.js'))
	return subChild.add1(1)
}
const return1 = async () => 1


const getSmol = async () => {
	const smol = await module.parent.thread.require(path.join(__dirname, './smol.js'))
	console.log(await smol.smol(1))
	return "HI"
}

module.exports = { add1, add1Deep, return1, getSmol }