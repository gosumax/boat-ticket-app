export async function runReview(input) {
  return {
    stage: 'review',
    status: 'mock',
    task: input?.task || '',
    notes: ['Review stage is a stub.'],
  };
}
