export const smol = (s: number): number => s+1;

export const zero = (): number[] => [0];

export const big = (ssss: string): Promise<number> => new Promise(res => res(parseInt(ssss)+1));

export const smolString = "Hello World";