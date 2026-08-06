const PREFIX = "COHUB_TEST_SUMMARY ";

export default async function* summaryReporter(source) {
  for await (const event of source) {
    if (event.type === "test:summary" && !event.data.file) {
      yield `${PREFIX}${JSON.stringify(event.data.counts)}\n`;
    }
  }
}
