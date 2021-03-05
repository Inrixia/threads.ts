export const smol = (s: number): number => s+1;

export const zero = (): number[] => [0];

export const big = (s: string): Promise<number> => new Promise(res => res(parseInt(s)+1));

export const smolString = "Hello World";