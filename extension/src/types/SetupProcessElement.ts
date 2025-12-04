
import { SetupProcessElementResult } from "./SetupProcessElementResult"
import { ref } from 'vue'

export class SetupProcessElement {
  public waitingMessage: string
  // TODO: Ugly approach - clean up and test later on...
  public result: Promise<SetupProcessElementResult>|SetupProcessElementResult
  public resultPending = ref(true)

  constructor(
    waitingMessage: string,
    result: Promise<SetupProcessElementResult>
  ) {
    this.waitingMessage = waitingMessage
    this.result = result

    // Register handlers to update resultPending once the promise settles
    this.result
      .then(result => {
        this.result = result;
        this.resultPending.value = false;
      })
      .catch(() => {
        this.result = {
          successful: false,
          message: "Unknown error occured!"
        };
        this.resultPending.value = false;
      })
  }
}