<script setup lang="ts">
/**
 * „Über“ (spec 4.9), for everyone with access. The versions are plain text; the links are built only from constants
 * and the extension's version (`app/links.ts`, which checks it), open in a new tab without opener or referrer.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { guideUrl, licenseUrl, releaseUrl } from '../app/links';
import { useAppState } from '../app/useAppState';
import { BASE_PATH } from '../config';
import PageHeader from '../ui/PageHeader.vue';

const { t } = useI18n();
const app = useAppState();

const version = app.appVersion;
const backendVersion = computed(() => app.backendVersion.value);
/** Bundled with the build (`vite.config.ts`), next to `index.html`. */
const THIRD_PARTY = `${BASE_PATH}THIRD-PARTY-LICENSES.txt`;
</script>

<template>
    <PageHeader
        icon="info"
        :title="t('nav.about')"
        :intro="t('about.intro')"
    />
    <div class="cps-about">
        <ul class="cps-about__versions">
            <li>{{ t('about.extensionVersion', { version }) }}</li>
            <!-- The page shows only after a login (state user or admin), which brings the backend's version. -->
            <li v-if="backendVersion">
                {{ t('about.backendVersion', { version: backendVersion }) }}
            </li>
        </ul>
        <ul class="cps-about__links">
            <li>
                <a
                    :href="guideUrl(version)"
                    target="_blank"
                    rel="noopener noreferrer"
                >{{ t('about.guide') }}</a>
            </li>
            <li>
                <a
                    :href="releaseUrl(version)"
                    target="_blank"
                    rel="noopener noreferrer"
                >{{ t('about.news') }}</a>
            </li>
        </ul>
        <p class="cps-about__legal">
            <a
                :href="licenseUrl(version)"
                target="_blank"
                rel="noopener noreferrer"
            >{{ t('about.copyright') }}</a>
            <br>
            <a
                :href="THIRD_PARTY"
                target="_blank"
                rel="noopener noreferrer"
            >{{ t('about.thirdParty') }}</a>
        </p>
    </div>
</template>

<style scoped>
.cps-about {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
    margin-top: var(--cps-space-5);
}
.cps-about ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-1);
    overflow-wrap: anywhere;
}
.cps-about__legal {
    margin: 0;
    color: var(--cps-text-muted);
    font-size: var(--cps-size-sm);
    line-height: 1.8;
}
</style>
