<template>
  <SetupStep title="Encryption Setup">

    <v-card>
      <SetupProcessList :elements="statusItems" />
    </v-card>


    <SetupInfoBox
    :visible="encryptionPassword !== ''"
    class="mt-6"
    >
      <strong>Important!</strong><br />
      Your RSA public-private-key-pairs to store passwords securely were created successfully. Please download your public and private key files below and store them securely!<br />
      You need them to setup further applications that need to read and/or write the secondary password.<br />
      <br />
      <strong>But be careful:</strong> If your private key gets known, the passwords can be decrypted! Consequently, your private key is additionally protected by a password.<br />
      Your password for encrypting the private key is:<br />
      <pre class='mt-2 mb-2'>{{encryptionPassword}}</pre>
      Store this password securely.
    </SetupInfoBox>

    <div v-if="publicKeyPem" class="d-flex gap-2 mt-3">
        <v-btn
          color="success"
          variant="outlined"
          class="mr-4 mb-4"
          @click="downloadPem(publicKeyPem, 'public_key.pem')"
        >
          Download Public Key
        </v-btn>
        <v-btn
          color="error"
          variant="outlined"
          @click="downloadPem(privateKeyPem, 'private_key.pem')"
        >
          Download Private Key
        </v-btn>
    </div>

    
    <br />


    <SetupCheckboxBox v-if="publicKeyPem"
      v-model="confirmed"
      :content="''"
      label="I have securly saved the public key, the private key and the password to the private key."
    >
    Confirm to continue...
    </SetupCheckboxBox>

    <br />

  </SetupStep>
</template>

<script setup lang="ts">
import SetupStep from './SetupStep.vue'
import SetupProcessList from '../components/SetupProcessList.vue'
import { SetupProcessElement } from '../types/SetupProcessElement'
import { SetupProcessElementResult } from '../types/SetupProcessElementResult'
import SetupInfoBox from './SetupInfoBox.vue'
import SetupCheckboxBox from './SetupCheckboxBox.vue'

import { ref, onMounted, watch } from 'vue'
import { inject } from 'vue'
import { ExtensionData } from '../api/ExtensionData'
import { AppConfig } from '../AppConfig'
import forge from 'node-forge'



const churchtoolsClient = inject('churchtoolsClient');
const statusItems = ref<SetupProcessElement[]>([]);
const allOkay = ref(false);
const publicKeyPem = ref('');
const privateKeyPem = ref('');
const encryptionPassword = ref('');
const confirmed = ref(false);
import { reactive } from 'vue'




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

    const hasData = await extensionData.categoryHasData(AppConfig.ENCRYPTION_SETTINGS_CATEGORY);

    if (!hasData) {
        
      statusItems.value.push(new SetupProcessElement(
        'Generating RSA key pair...',
        generateKeyPair(extensionData)
      ));

    } else {
      statusItems.value.push(new SetupProcessElement(
          '',
          alreadyExists()
        ));
      emit('completed');

    }
});


async function alreadyExists(): Promise<SetupProcessElementResult> {
  return {
    successful: true,
    message: 'Encryption already setup. No need to generate it...'
  }
}

async function storeEncryption(extensionData: ExtensionData): Promise<SetupProcessElementResult> {
        try {

            const payload = {
                publicKey: publicKeyPem.value,
            };
            await extensionData.createCategoryEntry(AppConfig.ENCRYPTION_SETTINGS_CATEGORY, payload);

            return {
              successful: true,
              message: 'Encryption setup successful.'
            };

        } catch (error) {
            console.error('Creation of internal settings failed:', error);
            return {
              successful: false,
              message: 'Failed to setup encryption. See console for details.'
            }
        }
    
}


async function generateKeyPair(extensionData: ExtensionData): Promise<SetupProcessElementResult> {

    try {

      // Generate a random password (32 characters)
      const randomBytes = forge.random.getBytesSync(24);
      const password = forge.util.encode64(randomBytes);

      const { publicKey, encryptedPrivateKey } = await generateRSAKeyPair(password);

      publicKeyPem.value = publicKey;
      privateKeyPem.value = encryptedPrivateKey;
      encryptionPassword.value = password;

      // Start the storage process
      statusItems.value.push(new SetupProcessElement(
        'Storing encryption data...',
        storeEncryption(extensionData)
      ));

      return {
        successful: true,
        message: 'Generation of RSA key pair successful.'
      }

    } catch (error) {
      console.error('RSA key generation failed:', error);
      return {
        successful: false,
        message: 'Failed to generate RSA key pair. See console for details.'
      }
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
