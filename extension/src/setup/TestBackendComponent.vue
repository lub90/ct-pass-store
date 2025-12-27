<template>
  <SetupStep title="Testing backend connectivity…">

    <!-- Intro text -->
    <v-card-text class="mb-3 font-weight-semibold">
      Contacting the PHP backend and running self‑tests...
    </v-card-text>

    <SetupProcess
      :elements="testSteps"
      successMessage="All backend self‑tests passed successfully."
      failMessage="One or more backend self‑tests failed. Please check the messages above."
      @complete="onComplete"
    />

  </SetupStep>
</template>

<script setup lang="ts">
import SetupStep from './SetupStep.vue'
import SetupProcess from '../components/SetupProcess.vue'
import { ref, onMounted } from 'vue'
import { inject } from 'vue'
import { ExtensionData } from '@/ct-extension-utils/lib/ExtensionData'
import { AppConfig } from '../AppConfig'
import { SetupProcessElement } from '../types/SetupProcessElement'
import { SetupProcessElementResult } from '../types/SetupProcessElementResult'

const churchtoolsClient = inject('churchtoolsClient')
const extensionData: ExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY)

const finished = ref(false)
const allOkay = ref(false)
const testSteps = ref<SetupProcessElement[]>([])

const emit = defineEmits<{
  (e: 'completed'): void
}>()

onMounted(async () => {
  try {
    // read backend URL from settings category
    const settingsEntry = await extensionData.getCategoryData(AppConfig.SETTINGS_CATEGORY, true)
    const jsonSettingsEntry = JSON.parse(settingsEntry["value"])
    const backendUrl: string = jsonSettingsEntry?.backendUrl

    if (!backendUrl) {
      testSteps.value.push(new SetupProcessElement(
        'Backend URL not configured',
        Promise.resolve({
          successful: false,
          message: 'No backend URL found in settings category.'
        })
      ))
      finished.value = true
      return
    }

     testSteps.value.push(new SetupProcessElement(
      'Testing PHP Backend',
      backendTest(backendUrl)
    ))
    

  } catch (error) {
    console.error('Backend test failed:', error)
    testSteps.value.push(new SetupProcessElement(
      'Backend test failed',
      Promise.resolve({
        successful: false,
        message: 'Could not test backend. See console for details.'
      })
    ))
    finished.value = true
    allOkay.value = false
  }
})


async function backendTest(backendUrl: string): Promise<SetupProcessElementResult> {
    // call /test endpoint
    const userId = (await churchtoolsClient.get('/whoami'))['id'];
    const loginToken = await churchtoolsClient.get(`/persons/${userId}/logintoken`);
    const response = await fetch(`${backendUrl}/test`, {
    method: 'GET',
    headers: {
        'Authorization': `Login ${loginToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
    })
    const json = await response.json()

    // individual test steps
    json.tests.forEach((t: any) => {
      testSteps.value.push(new SetupProcessElement(
        `Running ${t.name}...`,
        Promise.resolve({
          successful: t.status === 'ok',
          message: t.message
        })
      ))
    })

    // mark finished
    finished.value = true
    allOkay.value = json.tests.every((t: any) => t.status === 'ok')

    return {
        successful: json.summary?.toLowerCase().includes('success'),
        message: json.summary
      }
}

function onComplete() {
  emit('completed')
}
</script>
