<template>
  <div class="menu">
    <div class="menu__content">
      <!-- Custom menu -->
      <portal-target name="menu" class="menu__custom" />
    </div>

    <!-- Ads/Lesson -->
    <div class="menu__bottom">
      <AppAds />
    </div>
  </div>
</template>

<script>
import { Help } from '~/modules'

export default {
  data: () => ({
    help: Help,
  }),
}
</script>

<style lang="scss" scoped>
@keyframes logoAnim {
  0% {
    background-position: 0% 0%;
  }

  50% {
    background-position: 100% 0%;
  }

  100% {
    background-position: 0% 0%;
  }
}

.menu {
  @apply flex flex-col;
  @apply bg-menus relative;

  &::v-deep {
    section {
      @apply mb-6;
    }

    .item {
      @apply mb-1 p-3 #{!important};
    }
  }
}

.menu__content {
  @apply flex-1;
  height: calc(100vh - 80px - 250px);
}

.menu__custom {
  @apply p-3 overflow-y-auto h-full;
}

.menu__bottom {
}
</style>
