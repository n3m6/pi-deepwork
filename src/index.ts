export function getReadyMessage(): string {
  return 'deepwork-pi TypeScript project ready';
}

function main(): void {
  console.log(getReadyMessage());
}

if (require.main === module) {
  main();
}
