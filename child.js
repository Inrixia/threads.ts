const { Parent } = require('./lib/Thread.js')
const subChild = new Parent('./subChild.js')

const Magic = async () => await subChild.test()

module.exports = { Magic }