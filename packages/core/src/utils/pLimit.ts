export function pLimit(concurrency: number) {
    if (concurrency < 1) {
        throw new TypeError('Expected `concurrency` to be a number from 1 and up');
    }

    const queue: (() => void)[] = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;
        if (queue.length > 0) {
            queue.shift()!();
        }
    };

    const run = async <T>(fn: () => Promise<T>, resolve: (value: T) => void, reject: (reason?: unknown) => void) => {
        activeCount++;
        try {
            const result = await fn();
            resolve(result);
        } catch (error) {
            reject(error);
        }
        next();
    };

    return <T>(fn: () => Promise<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const task = () => run(fn, resolve, reject);
            if (activeCount < concurrency) {
                task();
            } else {
                queue.push(task);
            }
        });
    };
}
