import React from 'react'
import { Platform, Pressable, View } from 'react-native'
import { Composer, InputToolbar, Send } from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { testIdWithKey } from '../../utils/testable'

import { ChatIds } from './Chat.ids'

/**
 * The composer (chat redesign C2, Option A): a plain "+" outside on the left, a 40-point pill field with the emoji
 * button inside it on the right, and on the right Camera while the field is empty, Send once there is text. Buttons
 * are 44 points (48 dp on Android) whatever their glyph.
 */

/** A button's square: the platform's minimum tap target. */
export const COMPOSER_BUTTON = Platform.select({ android: 48, default: 44 }) as number
/** The field at one line; it grows a line at a time to {@link COMPOSER_MAX_LINES}, then scrolls. */
export const COMPOSER_FIELD = 40
export const COMPOSER_LINE = 21
export const COMPOSER_MAX_LINES = 5
/** For GiftedChat's minComposerHeight / maxComposerHeight: the TextInput inside the field's 1-point edge. */
export const COMPOSER_MIN_HEIGHT = COMPOSER_FIELD - 2
export const COMPOSER_MAX_HEIGHT = COMPOSER_LINE * COMPOSER_MAX_LINES + 18

const FIELD_EDGE = '#CFCACF'
const ICON = '#4A4A4A'

export const renderInputToolbar = (props: any, _theme: any) => (
  <InputToolbar
    {...props}
    containerStyle={{
      backgroundColor: '#F5F5F5', // Match chat background
      borderTopWidth: 0,
      paddingHorizontal: 6,
      paddingTop: 6,
      paddingBottom: 8,
    }}
    // The row itself is bare: the pill is the field, not the whole bar.
    primaryStyle={{
      alignItems: 'flex-end',
      backgroundColor: 'transparent',
      marginHorizontal: 0,
    }}
  />
)

/** `accessory` is drawn inside the field, after the text (the emoji button). */
export const renderComposer = (
  props: any,
  theme: any,
  placeholder: string,
  disabled?: boolean,
  accessory?: React.ReactNode
) => (
  // The field: a pill with a visible edge, so it reads as one even holding only an emoji and no caret (272).
  <View
    style={{
      flex: 1,
      minHeight: COMPOSER_FIELD,
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: '#FFFFFF',
      borderRadius: COMPOSER_FIELD / 2,
      borderWidth: 1,
      borderColor: FIELD_EDGE,
      paddingLeft: 14,
      marginHorizontal: 2,
    }}
    testID={testIdWithKey(ChatIds.composerField)}
  >
    {/*
     * Everything the TextInput needs goes through textInputProps, MERGED into
     * what gifted-chat passed down — never replacing it.
     *
     * gifted-chat v3's Composer destructures only ({ text, textInputProps }).
     * Top-level textInputStyle / placeholder / placeholderTextColor props are
     * v2 API and are silently ignored, and textInputProps carries two separate
     * things we must not drop:
     *
     *  - onChangeText and the input ref, the only path back to the controlled
     *    value={text}. Replacing the object left a controlled input with no
     *    change handler, so every keystroke reverted to '' and the keyboard
     *    re-asserted sentence capitalisation on the emptied field.
     *  - style, which Composer applies LAST and so is the only way to beat its
     *    own scheme-dependent default. That default is
     *    textInput_dark: { color: '#fff' }, and the toolbar above hardcodes a
     *    white background, so in dark mode the text was white on white —
     *    invisible but present (device 2026-08-26).
     */}
    <Composer
      {...props}
      textInputProps={{
        ...props.textInputProps,
        accessibilityLabel: placeholder,
        maxFontSizeMultiplier: 1.5,
        editable: !disabled,
        placeholder,
        placeholderTextColor: '#666666',
        style: [
          {
            ...theme.inputText,
            flex: 1,
            fontSize: 16,
            lineHeight: COMPOSER_LINE,
            paddingTop: 9,
            paddingBottom: 9,
            paddingHorizontal: 0,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 4,
          },
          props.textInputProps?.style,
        ],
      }}
    />
    {accessory}
  </View>
)

/** The emoji button inside the field: 38 points, so the field keeps its 40-point height. */
export const ComposerEmojiButton: React.FC<{ label: string; disabled?: boolean; onPress: () => void }> = ({
  label,
  disabled,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    hitSlop={4}
    style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
    accessibilityRole="button"
    accessibilityLabel={label}
    testID={testIdWithKey(ChatIds.composerEmoji)}
  >
    <Icon name="emoticon-happy-outline" size={22} color={ICON} />
  </Pressable>
)

/**
 * Send once the field holds text; until then, Camera when the chat takes photos (`camera`), else Send greyed out.
 * gifted-chat's Send refuses to fire on empty text by itself (onSend runs only when trimmedText.length ||
 * isTextOptional), so the greyed Send needs no guard of its own.
 */
export const renderSend = (props: any, theme: any, camera?: { label: string; onPress: () => void }) => {
  const hasText = !!props.text?.trim()
  if (!hasText && camera)
    return (
      <Pressable
        onPress={camera.onPress}
        style={{ width: COMPOSER_BUTTON, height: COMPOSER_BUTTON, alignItems: 'center', justifyContent: 'center' }}
        accessibilityRole="button"
        accessibilityLabel={camera.label}
        testID={testIdWithKey(ChatIds.composerCamera)}
      >
        <Icon name="camera-outline" size={24} color={ICON} />
      </Pressable>
    )
  return (
    <Send
      {...props}
      // v3 prop name. `alwaysShowSend` was v2 and is silently ignored; `disabled` is not part of v3's Send at all.
      isSendButtonAlwaysVisible={true}
      containerStyle={{
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 0,
        marginBottom: 0,
        height: COMPOSER_BUTTON,
        width: COMPOSER_BUTTON,
      }}
    >
      <View
        style={{
          backgroundColor: hasText ? theme.sendEnabled : '#E0E0E0',
          borderRadius: 18,
          width: 36,
          height: 36,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        testID={testIdWithKey(ChatIds.composerSend)}
      >
        <Icon name="arrow-up" size={22} color="white" />
      </View>
    </Send>
  )
}
