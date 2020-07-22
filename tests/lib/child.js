const path = require('path')

const { Parent } = require(path.join(__dirname, '../../index.js'))



const add1 = async num => num+1
const add1Deep = async num => {
	const subChild = new Parent(path.join(__dirname, './child.js'))
	return subChild.add1(1)
}
const return1 = async () => 1


const smol = async s => {
	const smol = await module.parent.thread.require(path.join(__dirname, './smol.js'))
	return smol.smol(s)
}

const deepSmol = async s => {
	const subChild = new Parent(path.join(__dirname, './child.js'))
	const smol =  new Parent(path.join(__dirname, './smol.js'))
	return subChild.smol(s).catch(console.log)
}

module.exports = { add1, add1Deep, return1, smol, deepSmol }