package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Test

/** Same cases as src/lib/reminder-channel.test.ts. */
class ReminderChannelsTest {
  @Test fun idEncodesStrengthSoundAndVibration() {
    assertEquals("breaks_balanced_chime1_v1", ReminderChannels.channelId("balanced", "chime1", true))
    assertEquals("breaks_firm_chime4_v0", ReminderChannels.channelId("firm", "chime4", false))
    assertEquals("breaks_gentle_none_v1", ReminderChannels.channelId("gentle", "none", true))
  }

  @Test fun differentSettingsGiveDifferentIds() {
    val a = ReminderChannels.channelId("balanced", "chime1", true)
    assertEquals(false, a == ReminderChannels.channelId("balanced", "chime2", true))
    assertEquals(false, a == ReminderChannels.channelId("balanced", "chime1", false))
    assertEquals(false, a == ReminderChannels.channelId("firm", "chime1", true))
  }

  @Test fun gentleDefaultImportanceNoSoundNoVibrationWhateverTheSettingsSay() {
    assertEquals(
      ReminderChannels.Spec("breaks_gentle_none_v0", highImportance = false, sound = "none", vibration = false),
      ReminderChannels.spec("gentle", "chime2", true)
    )
  }

  @Test fun balancedHeadsUpChosenSoundVibrationPerSetting() {
    assertEquals(
      ReminderChannels.Spec("breaks_balanced_chime2_v0", highImportance = true, sound = "chime2", vibration = false),
      ReminderChannels.spec("balanced", "chime2", false)
    )
  }

  @Test fun firmHeadsUpChosenSoundVibrationAlwaysOn() {
    assertEquals(
      ReminderChannels.Spec("breaks_firm_chime3_v1", highImportance = true, sound = "chime3", vibration = true),
      ReminderChannels.spec("firm", "chime3", false)
    )
  }

  @Test fun everyIdStartsWithThePrefixSoStaleChannelsCanBeFound() {
    assertEquals(true, ReminderChannels.channelId("balanced", "chime3", false).startsWith(ReminderChannels.CHANNEL_PREFIX))
  }

  @Test fun moveRemindersOwnFamilyWithTheSameStrengthRules() {
    assertEquals(
      ReminderChannels.Spec("move_balanced_chime1_v1", true, "chime1", true),
      ReminderChannels.spec("balanced", "chime1", true, ReminderChannels.MOVE_CHANNEL_PREFIX),
    )
    assertEquals("move_gentle_none_v0", ReminderChannels.spec("gentle", "chime2", true, ReminderChannels.MOVE_CHANNEL_PREFIX).id)
  }
}
