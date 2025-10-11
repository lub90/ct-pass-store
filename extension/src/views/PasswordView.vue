<template>
    <SetupGuard>
        <BaseLayout>
            <template #title>🔑 Change Password</template>
            
            <div>
                <p>Hier kannst du dein Passwort aktualisieren.</p>
            </div>
            
            <template #footer>
                <div class="custom-footer">🔑 Passwortseite – Sicherheit zuerst!</div>
            </template>
        </BaseLayout>
    </SetupGuard>
</template>

<script setup lang="ts">
import SetupGuard from '../layouts/SetupGuard.vue';
import BaseLayout from '../layouts/BaseLayout.vue';
</script>
