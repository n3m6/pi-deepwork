export function getReadyMessage(): string {
  return 'pi-deepwork TypeScript project ready';
}

function main(): void {
  console.log(getReadyMessage());
}

if (require.main === module) {
  main();
}
