# 產生台語喊牌語音：pip install imageio-ffmpeg，然後 python tools/gen_voice.py
# 台詞用台羅寫，送到意傳科技的台語語音合成（hapsing.ithuan.tw）拿到原聲，
# 再用 ffmpeg 壓音高、加抖音、加沙啞、推到破音，做出四個老牌咖的聲音。
# 改了這裡的角色或每種喊法的句數，js/voice.js 裡的 VOICES、LINES 也要跟著改。
import pathlib
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = pathlib.Path(__file__).resolve().parent.parent / 'audio' / 'voice'
TTS = 'https://hapsing.ithuan.tw/bangtsam?taibun='
RATE = 16000  # 原聲的取樣率

# 角色的聲音：
#   pitch  音高倍數（連共鳴一起移，壓低就像男聲）
#   speed  最後的語速倍數
#   shake  老人的抖音 (頻率, 深度毫秒)，沒有就 None
#   rasp   沙啞 (頻率, 深度)
#   drive  推到破音的增益 dB，越大越兇
#   bright 高頻加多少 dB，越大越尖
VOICES = {
    'ama': dict(pitch=0.93, speed=0.94, shake=(6.5, 1.5), rasp=(48, 0.35), drive=11, bright=3),    # 阿嬤
    'asang': dict(pitch=1.06, speed=1.14, shake=(7.5, 0.7), rasp=(70, 0.25), drive=13, bright=7),  # 歐巴桑
    'abei': dict(pitch=0.70, speed=0.95, shake=(5, 1.2), rasp=(38, 0.55), drive=15, bright=2),     # 阿伯
    'aming': dict(pitch=0.80, speed=1.16, shake=None, rasp=(60, 0.3), drive=13, bright=4),         # 大叔
}

# 每個角色、每種喊法的台詞（台羅）。同一種有幾句就隨機挑。
LINES = {
    'ama': {
        'chi': ['Tsia̍h--lah!', 'Tsia̍h! To-siā--ooh!'],              # 食啦／食！多謝喔
        'pong': ['Phòng--lah!', 'Phòng! Mài tsáu!'],                   # 碰啦／碰！莫走
        'kong': ['Kòng--lah!', 'Kòng! Iáu-siū--ooh!'],                 # 槓啦／槓！夭壽喔
        'ankong': ['Àm-kòng!'],
        'jiakong': ['Ka-kòng!'],
        'hu': ['Kàu--ah! Pháinn-sè--lah!', 'Kàu--ah! To-siā--lah!'],   # 到矣！歹勢啦／到矣！多謝啦
        'zimo': ['Tsū-bong--lah! Iáu-siū--ooh!', 'Tsū-bong! Lóng the̍h lâi!'],  # 自摸啦！夭壽喔／自摸！攏提來
        'qiang': ['Tshiúnn-kòng!', 'Tshiúnn-kòng! Kàu--ah!'],
    },
    'asang': {
        'chi': ['Tsia̍h--lah!', 'Tsia̍h! Kín--leh!'],                  # 食啦／食！緊咧
        'pong': ['Phòng--lah!', 'Phòng! Guá--ê!'],                     # 碰啦／碰！我的
        'kong': ['Kòng--lah!', 'Kòng! Koh lâi!'],                      # 槓啦／槓！閣來
        'ankong': ['Àm-kòng!'],
        'jiakong': ['Ka-kòng!'],
        'hu': ['Kàu--ah!', 'Kàu--lah! Pháinn-sè!'],                    # 到矣／到啦！歹勢
        'zimo': ['Tsū-bong--lah!', 'Tsū-bong! Tsînn the̍h lâi!'],      # 自摸啦／自摸！錢提來
        'qiang': ['Tshiúnn-kòng!', 'Tshiúnn-kòng! Kàu--ah!'],
    },
    'abei': {
        'chi': ['Tsia̍h!', 'Tsia̍h--lah! Kín--leh!'],                  # 食／食啦！緊咧
        'pong': ['Phòng!', 'Phòng! Tsit tiunn guá--ê!'],               # 碰／碰！這張我的
        'kong': ['Kòng!', 'Kòng--lah! Koh lâi!'],                      # 槓／槓啦！閣來
        'ankong': ['Àm-kòng!'],
        'jiakong': ['Ka-kòng!'],
        'hu': ['Kàu--ah! Tán tsiok kú--ah!', 'Kàu--lah! Tsînn the̍h lâi!'],  # 到矣！等足久矣／到啦！錢提來
        'zimo': ['Tsū-bong! Sóng--lah!', 'Tsū-bong--lah! Tsînn the̍h lâi!'],  # 自摸！爽啦／自摸啦！錢提來
        'qiang': ['Tshiúnn-kòng!', 'Tshiúnn-kòng! Kàu--ah!'],
    },
    'aming': {
        'chi': ['Tsia̍h--lah!', 'Tsia̍h! Bián kheh-khì!'],             # 食啦／食！免客氣
        'pong': ['Phòng--lah!', 'Phòng! Bián tsáu!'],                  # 碰啦／碰！免走
        'kong': ['Kòng--lah!', 'Kòng! Tsán--lah!'],                    # 槓啦／槓！讚啦
        'ankong': ['Àm-kòng!'],
        'jiakong': ['Ka-kòng!'],
        'hu': ['Kàu--ah! Sóng--lah!', 'Kàu--lah! To-siā!'],            # 到矣！爽啦／到啦！多謝
        'zimo': ['Tsū-bong--lah! Tsán--lah!', 'Tsū-bong! Lóng the̍h lâi!'],  # 自摸啦！讚啦／自摸！攏提來
        'qiang': ['Tshiúnn-kòng!', 'Tshiúnn-kòng! Kàu--ah!'],
    },
}


def ffmpeg(*args):
    return subprocess.run([FF, '-hide_banner', '-y', *args], capture_output=True, text=True,
                          encoding='utf-8', errors='replace', check=True).stderr


def chain(v, gain):
    f = [
        f'volume={gain:.1f}dB',                      # 先把原聲拉到滿
        f'asetrate={RATE * v["pitch"]:.0f}', 'aresample=44100',
        f'atempo={v["speed"] / v["pitch"]:.3f}',
    ]
    if v['shake']:
        f.append('chorus=0.01:1:20:1:{}:{}'.format(*v['shake']))  # 只留延遲的聲音，就是抖音
    f += [
        'tremolo=f={}:d={}'.format(*v['rasp']),
        'highpass=f=140',
        f'equalizer=f=2600:t=q:w=1:g={v["bright"]}',
        'acompressor=threshold=-22dB:ratio=6:attack=3:release=60:makeup=4',
        f'volume={v["drive"]}dB', 'asoftclip=type=tanh',
        'aecho=0.85:0.5:28:0.22',                    # 一點牌間的回音
        'volume=5dB', 'asoftclip=type=tanh',
    ]
    return ','.join(f)


def main():
    raw = {}
    with tempfile.TemporaryDirectory() as tmp:
        for who, calls in LINES.items():
            (OUT / who).mkdir(parents=True, exist_ok=True)
            for key, lines in calls.items():
                for i, text in enumerate(lines):
                    if text not in raw:
                        raw[text] = pathlib.Path(tmp) / f'{len(raw)}.mp3'
                        raw[text].write_bytes(urllib.request.urlopen(TTS + urllib.parse.quote(text), timeout=60).read())
                        time.sleep(0.3)
                    peak = float(re.search(r'max_volume: (-?[\d.]+) dB', ffmpeg(
                        '-i', str(raw[text]), '-af', 'volumedetect', '-f', 'null', '-')).group(1))
                    path = OUT / who / f'{key}{i}.mp3'
                    ffmpeg('-i', str(raw[text]), '-af', chain(VOICES[who], -peak),
                           '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', str(path))
                    print(f'{who}/{key}{i}', path.stat().st_size)


main()
