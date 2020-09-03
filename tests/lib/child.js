const path = require('path')
const { Parent } = require('../../index.js')

module.parent.thread.on('eventFromParent', (...args) => module.parent.thread.emit('eventFromChild', ...args))

const add1 = async num => num+1

const add1Slow = num => new Promise((resolve, reject) => setTimeout(() => resolve(num+1), Math.random()*1000))

const add1Deep = async num => {
	const subChild = new Parent(path.join(__dirname, './child.js'))
	return subChild.add1(1)
}
const return1 = async () => 1


const smol = async s => {
	const smol = await module.parent.thread.require('smol')
	return smol.smol(s)
}

const deepSmol = async s => {
	const subChild = new Parent(path.join(__dirname, './child.js'), { name: 'child' })
	return subChild.smol(s)
}

module.exports = { add1, add1Slow, add1Deep, return1, smol, deepSmol }