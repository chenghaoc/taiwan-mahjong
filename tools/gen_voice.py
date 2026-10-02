# 產生喊牌語音：pip install edge-tts，然後 python tools/gen_voice.py
# 用微軟的台灣國語聲線，壓低音高、放慢，做出阿嬤、阿伯的感覺。
# 改了這裡的角色或台詞，js/voice.js 裡的 VOICES、LINES 也要跟著改。
import asyncio
import pathlib

import edge_tts

OUT = pathlib.Path(__file__).resolve().parent.parent / 'audio' / 'voice'

# 角色：聲線、音高、語速
VOICES = {
    'ama': ('zh-TW-HsiaoChenNeural', '-22Hz', '-12%'),   # 阿嬤
    'asang': ('zh-TW-HsiaoYuNeural', '-14Hz', '-4%'),    # 歐巴桑
    'abei': ('zh-TW-YunJheNeural', '-24Hz', '-14%'),     # 阿伯
    'aming': ('zh-TW-YunJheNeural', '-6Hz', '+6%'),      # 大叔
}

# 每種喊牌的台詞，同一種有幾句就隨機挑
LINES = {
    'chi': ['吃！', '吃啦！'],
    'pong': ['碰！', '碰啦！'],
    'kong': ['槓！', '槓啦！'],
    'ankong': ['暗槓！'],
    'jiakong': ['加槓！'],
    'hu': ['胡了！', '胡啦！哈哈哈哈！'],
    'zimo': ['自摸！', '自摸啦！哈哈哈！'],
    'qiang': ['搶槓胡！', '搶槓，胡啦！'],
}


async def main():
    for who, (voice, pitch, rate) in VOICES.items():
        (OUT / who).mkdir(parents=True, exist_ok=True)
        for key, lines in LINES.items():
            for i, text in enumerate(lines):
                path = OUT / who / f'{key}{i}.mp3'
                await edge_tts.Communicate(text, voice, pitch=pitch, rate=rate, volume='+20%').save(str(path))
                print(path.relative_to(OUT), path.stat().st_size)


asyncio.run(main())
