let up = false;
setTimeout(() => up = true, 50)
while (!up);console.log(up)
console.log('exited loop')