const path = require('path')

const add1 = async num => num+1
const add1Deep = async num => {
	const { Parent } = require(path.join(__dirname, '../../index.js'))
	const subChild = new Parent(path.join(__dirname, './child.js'))
	return subChild.add1(1)
}
module.exports = { add1, add1Deep }