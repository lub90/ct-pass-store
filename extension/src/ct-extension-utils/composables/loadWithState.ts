import { ref } from "vue";
import { ViewState } from "../types/ViewState";

export function loadWithState<T>(
    fn: () => Promise<T>,
    runImmediately: boolean = true
  ) {
  const state = ref<ViewState>(ViewState.Loading);
  const error = ref<string | null>(null);
  const data = ref<T | null>(null);

  async function execute() {
    state.value = ViewState.Loading;
    error.value = null;

    try {
      data.value = await fn();
      state.value = ViewState.Ready;
    } catch (e: any) {
      error.value = e?.message ?? "Unknown error";
      state.value = ViewState.Error;
    }
  }

  // Run automatically unless disabled
  if (runImmediately) {
    execute();
  }

  return {
    state,
    error,
    data,
    execute,
  };
}
