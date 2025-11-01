<template>
  <SetupStep title="Setting up Encryption…">
    <SetupStatusList :items="statusItems" />


    <SetupInfoBox
    :visible="encryptionPassword !== ''"
    :content="infoBoxContent"
    />

    <div v-if="publicKeyPem" class="d-flex gap-2 mt-3">
        <button class="btn btn-outline-success" @click="downloadPem(publicKeyPem, 'public_key.pem')">
            Download Public Key
        </button>
        <button class="btn btn-outline-danger" @click="downloadPem(privateKeyPem, 'private_key.pem')">
            Download Private Key
        </button>
    </div>

    
    <br />


    <SetupCheckboxBox v-if="publicKeyPem"
      v-model="confirmed"
      :content="''"
      label="I have securly saved the public key, the private key and the password to the private key."
    />

    <br />

  </SetupStep>
</template>

<script setup lang="ts">
import SetupStep from './SetupStep.vue';
import SetupStatusList from './SetupStatusList.vue';
import SetupResultBox from './SetupResultBox.vue';
import SetupInfoBox from './SetupInfoBox.vue'
import SetupCheckboxBox from './SetupCheckboxBox.vue'

import { ref, onMounted, watch } from 'vue';
import { inject } from 'vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';
import forge from 'node-forge';
import { computed } from 'vue';



const churchtoolsClient = inject('churchtoolsClient');
const statusItems = ref<StatusItem[]>([]);
const allOkay = ref(false);
const publicKeyPem = ref('');
const privateKeyPem = ref('');
const encryptionPassword = ref('');
const confirmed = ref(false);



const infoBoxContent = computed(() => `
          <strong>Important!</strong><br />
            Your RSA public-private-key-pairs to store passwords securely were created successfully. Please download your public and private key files below and store them securely!<br />
            You need them to setup further applications that need to read and/or write the secondary password.<br />
            <br />
            <strong>But be careful:</strong> If your private key gets known, the passwords can be decrypted! Consequently, your private key is additionally protected by a password.<br />
            Your password for encrypting the private key is:<br />
            <pre class='mt-2 mb-2'>${encryptionPassword.value}</pre>
            Store this password securely.
    `);

// Watch for checkbox change and emit immediately when checked
watch(confirmed, (val) => {
  if (val) emit('completed');
});

const emit = defineEmits<{
    (e: 'completed'): void;
}>();


onMounted(async () => {
    const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

    // TODO: Check if we have write permissions...

    const hasData = await extensionData.categoryHasData(AppConfig.INTERNAL_SETTINGS_CATEGORY);

    if (!hasData) {
        
        await generateKeyPair();
        await storeEncryption(extensionData);

    } else {

        statusItems.value.push({
            pending: false,
            message: 'Encryption already setup. No need to generate it...',
            icon: 'bi-check-circle-fill text-success',
            variant: 'success',
        });
        emit('completed');
    }

    // Verify final state
    const updatedExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
    try {
        const entry = await updatedExtensionData.getCategoryData(AppConfig.INTERNAL_SETTINGS_CATEGORY, true);
        if (entry && entry.id) {
            allOkay.value = true;
        }
    } catch (error) {
        console.warn('Internal settings verification failed:', error);
    }
});


async function storeEncryption(extensionData: ExtensionData) {
    statusItems.value.push({
            pending: true,
            message: 'Storing encryption data...',
        });

        try {

            const payload = {
                publicKey: publicKeyPem.value,
            };
            await extensionData.createCategoryEntry(AppConfig.INTERNAL_SETTINGS_CATEGORY, payload);

            statusItems.value.splice(-1, 1, {
                pending: false,
                message: 'Encryption setup successfully.',
                icon: 'bi-check-circle-fill text-success',
                variant: 'success',
            });
        } catch (error) {
            statusItems.value.splice(-1, 1, {
                pending: false,
                message: 'Failed to setup encryption. See console for details.',
                icon: 'bi-x-circle-fill text-danger',
                variant: 'danger',
            });
            console.error('Creation of internal settings failed:', error);
        }
    
}


async function generateKeyPair() {
    statusItems.value.push({
      pending: true,
      message: 'Generating RSA key pair...',
    });

    try {

      // Generate a random password (32 characters)
      const randomBytes = forge.random.getBytesSync(24);
      const password = forge.util.encode64(randomBytes);
      console.log(password);

      const { publicKey, encryptedPrivateKey } = await generateRSAKeyPair(password);

      publicKeyPem.value = publicKey;
      privateKeyPem.value = encryptedPrivateKey;
      encryptionPassword.value = password;
      console.log(encryptionPassword.value);

      statusItems.value.splice(-1, 1, {
        pending: false,
        message: 'Generation of RSA key par successfull.',
        icon: 'bi-check-circle-fill text-success',
        variant: 'success',
      });

    } catch (error) {
      statusItems.value.splice(-1, 1, {
        pending: false,
        message: 'Failed to generate RSA key pair. See console for details.',
        icon: 'bi-x-circle-fill text-danger',
        variant: 'danger',
      });
      console.error('RSA key generation failed:', error);
    }
}


async function generateRSAKeyPair(encryptionPwd: string): Promise<{ publicKey: string; encryptedPrivateKey: string }> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 4096, workers: -1 }, (err, keypair) => {
      if (err) return reject(err);

      const publicKey = forge.pki.publicKeyToPem(keypair.publicKey);
      const privateKey = forge.pki.privateKeyToPem(keypair.privateKey);
      const encryptedPrivateKey = forge.pki.encryptRsaPrivateKey(keypair.privateKey, encryptionPwd, {
        algorithm: 'aes256',
      });

      resolve({ publicKey, encryptedPrivateKey });
    });
  });
}


function downloadPem(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/x-pem-file' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
</script>
