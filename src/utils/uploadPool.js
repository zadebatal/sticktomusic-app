/**
 * uploadPool — Concurrent task execution pool
 *
 * Processes an array of items through an async worker function with
 * bounded concurrency. Used to parallelize file uploads, image conversions, etc.
 */

/**
 * Run items through workerFn with bounded concurrency.
 * @param {Array} items — items to process
 * @param {Function} workerFn — async (item, index) => result
 * @param {Object} options
 * @param {number} options.concurrency — max simultaneous tasks (default 5)
 * @param {Function} options.onProgress — (completed, total) callback
 * @returns {Promise<{ results: Array, errors: Array<{ index, item, error }> }>}
 */
export const runPool = async (items, workerFn, { concurrency = 5, onProgress } = {}) => {
  const results = new Array(items.length);
  const errors = [];
  let completed = 0;
  let nextIndex = 0;

  const runNext = async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = await workerFn(items[i], i);
      } catch (err) {
        errors.push({ index: i, item: items[i], error: err });
        results[i] = null;
      }
      completed++;
      if (onProgress) onProgress(completed, items.length);
    }
  };

  // Launch up to `concurrency` workers
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(runNext());
  }
  await Promise.all(workers);

  return { results, errors };
};
