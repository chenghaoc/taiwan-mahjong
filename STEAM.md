# Steam Machine and controllers

The game can be played start to finish with a controller (Steam Machine, Steam Deck, Steam Controller, Xbox, PlayStation, Switch Pro) or a keyboard. Press any button and the page switches to controller mode: the mouse cursor hides, a gold cursor appears, and the hints show the buttons of the pad you are holding. Moving the mouse switches back.

## Controls

| | Controller | Keyboard |
|---|---|---|
| Move the cursor (hand tiles, buttons) | D-pad or left stick | Arrow keys |
| Discard the tile under the cursor / press a button | A | Enter or Space |
| Charge a throw | Hold A, release to throw | Hold Enter or Space |
| Pass (過), go back, cancel a charge | B | Esc or Backspace |
| 胡 / 自摸 | Y | H |
| Jump to the settings (提示、動畫、音效) and back | Start | Tab moves through all buttons |

On your turn the cursor starts on the tile you just drew; the hint above it shows what you would be waiting on. When 自摸 is possible the cursor starts on 自摸 instead. On a claim it starts on the first option (胡, 槓, 碰, 吃); B passes. The controller rumbles when it is your turn, when someone discards a tile you can claim, while you charge a throw (harder as the meter fills), and on a win.

## Steam Machine (SteamOS)

The game runs in a browser, so on a Steam Machine you add a browser as a non-Steam game that opens straight into the table. Use the hosted Render link (see `MULTIPLAYER.md`); SteamOS has no Node.js, so it cannot run `server.js` itself.

1. Switch to Desktop Mode. In Discover, install Google Chrome (Flathub).
2. In Steam (desktop), Games → Add a Non-Steam Game to My Library → Google Chrome.
3. Right-click the new entry → Properties. Rename it, for example 台灣十六張麻將. After the existing launch options (`run ... com.google.Chrome`), add:

   ```
   --kiosk --start-fullscreen --autoplay-policy=no-user-gesture-required "https://YOUR-SERVICE.onrender.com/"
   ```

   - `--kiosk` hides the browser frame.
   - `--autoplay-policy=no-user-gesture-required` is needed for sound: browsers only start audio after a click or key press, and a controller button does not count.
4. Controller → set the layout for this entry to **Gamepad** (or turn Steam Input off for it). The default browser layout turns the pad into a mouse, and then the page never sees a controller.
5. Return to Gaming Mode and launch it from the library.

To type a name for online play, press Steam + X for the on-screen keyboard; leaving it empty plays as 玩家. To quit, press the Steam button → Exit game.

Same idea on a Windows PC in Big Picture: add `chrome.exe` as a non-Steam game with the same launch options. To play offline, run `node server.js` on that PC and use `http://localhost:3000/` as the address.

## How it works

`js/pad.js` polls the Gamepad API every frame (standard mapping) and listens for the keys above. The cursor moves between "stops": the visible buttons, plus each hand tile on your turn. It picks the nearest stop in the pressed direction. Left and right in your hand stay in the hand and wrap around. Pressing A on a tile goes through the same press/release path as the mouse (`S.press` / `S.release` in `js/scene.js`), so tap-to-discard and hold-to-charge behave the same.
