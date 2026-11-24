# ひらがなの にわ の声を作って index.html の const VOICE に埋め込む（パソコンで実行）
#
# 使い方:
#   python3 gen_voice.py                       → VOICEVOX 玄野武宏（karada-game のことばと同じ声）で全部作る
#   python3 gen_voice.py voicevox:11 へ ん      → 「へ」「ん」だけ作り直す（ほかの声はそのまま残す）
#   python3 gen_voice.py ja-JP-NanamiNeural    → edge-tts で作る（pip install edge-tts が必要）
#
# VOICEVOX を使うとき:
#   - VOICEVOX ENGINE を 127.0.0.1:50021 で起動しておく（別の場所なら環境変数 VOICEVOX_URL）。
#   - ffmpeg が必要（PATH になければ ~/Desktop/音声/bin/ffmpeg、または環境変数 FFMPEG）。
#   - 公開ページには「VOICEVOX:玄野武宏」のクレジットを出す（ページ下の footer に書いてある）。
# 設定は karada-game のことばと同じ: 速さ 0.85、24kHz・モノラル・40kbps、無音カット、音量そろえ。
import base64,json,os,re,shutil,subprocess,sys,tempfile,urllib.parse,urllib.request

ARGS=sys.argv[1:]
VOICE=ARGS[0] if ARGS and not re.match(r'^[ぁ-ゟ]',ARGS[0]) else 'voicevox:11'
ONLY=set(ARGS[1:] if ARGS and VOICE==ARGS[0] else ARGS)  # 作り直す文字・ことば（空なら全部）
P=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','index.html')
FF=os.environ.get('FFMPEG') or shutil.which('ffmpeg') or next((p for p in [os.path.expanduser('~/Desktop/音声/bin/ffmpeg')] if os.path.exists(p)),None)
TRIM='silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse'

html=open(P,encoding='utf8').read()
rows=re.search(r'const ROWS=\[(.*?)\];\s*const ALL',html,re.S).group(1)
units={a or b for a,b in re.findall(r"'([ぁ-ゟ]+)'|\"([ぁ-ゟ]+)\"",rows)}
words={w[0] for w in json.loads(re.search(r'const WORDS=(\[.*?\]);\s*\n',html,re.S).group(1))}
texts=sorted(units|words)
old=json.loads(re.search(r'const VOICE=(\{.*?\});(?=\s*\n)',html,re.S).group(1))
todo=[t for t in texts if not ONLY or t in ONLY]
if ONLY-set(texts): sys.exit(f'ページにない文字・ことば: {" ".join(sorted(ONLY-set(texts)))}')
print(len(todo),'/',len(texts),'items /',VOICE)

# ───── VOICEVOX ─────
# ことばは漢字で読ませる（同じかなでもアクセントが正しくなる）。ここにない ことばは かなのまま読む。
KANJI=dict(x.split(':') for x in '''あい:愛 いえ:家 うえ:上 あお:青 あか:赤 かお:顔 いか:イカ いけ:池 こえ:声 さけ:酒 すし:寿司 しお:塩 せかい:世界 そら:空 たこ:タコ つき:月 とけい:時計 ねこ:猫 にく:肉 はな:花 ひと:人 ふね:船 へび:蛇 ほし:星 まど:窓 みみ:耳 むし:虫 めがね:眼鏡 もも:桃 やま:山 ゆき:雪 よる:夜 らいおん:ライオン りす:リス れもん:レモン わに:ワニ ほん:本 えんぴつ:鉛筆 くるま:車 さくら:桜 ひこうき:飛行機 うさぎ:ウサギ くま:熊 ぞう:象 ぶた:豚 かば:カバ ばなな:バナナ ぱん:パン たまご:卵 いちご:イチゴ みかん:ミカン りんご:リンゴ かさ:傘 とり:鳥 てがみ:手紙 うみ:海 あめ:雨 みず:水 いす:椅子 でんしゃ:電車 じてんしゃ:自転車 ちきゅう:地球 ぎゅうにゅう:牛乳 ちょうちょ:ちょうちょ しゃしん:写真 おちゃ:お茶 ひゃく:百 りょこう:旅行 ぎょうざ:餃子 びょういん:病院 かいしゃ:会社 おもちゃ:おもちゃ しゅくだい:宿題 ごはん:ご飯 どあ:ドア ぼうし:帽子 ぺん:ペン ぴあの:ピアノ ぷりん:プリン ぽすと:ポスト べんとう:弁当 かばん:カバン でんわ:電話 ぶどう:ブドウ くつ:靴 あひる:アヒル にわとり:ニワトリ うし:牛 うま:馬 さる:猿 とら:虎 きつね:狐 ぬいぐるみ:ぬいぐるみ がいこく:外国 ぎんこう:銀行 じしょ:辞書 ごみ:ゴミ ひよこ:ヒヨコ ちず:地図 ぜんぶ:全部 ぞうきん:雑巾 ずかん:図鑑 でぐち:出口 ばら:バラ きく:菊'''.split())
# 1文字のかなは かな入力（AquesTalk風記法）で読ませる。は・を が助詞として読まれないように。
MORA={'へ':('h','e')}   # かな入力だと ヘ が「え」になるので、音を直接決める
VLEN={'ん':0.30}        # ん だけだと 0.07秒で ほぼ聞こえないので のばす
KANA_MIN=0.22           # 1文字は短すぎるので、karada の1拍のことば（約0.24秒）に近づける
SPEED=0.85

def vv(path,params,body=None,raw=False):
    base=os.environ.get('VOICEVOX_URL','http://127.0.0.1:50021')
    r=urllib.request.Request(base+path+'?'+urllib.parse.urlencode(params),data=(json.dumps(body).encode() if body is not None else b''),method='POST',headers={'Content-Type':'application/json'})
    d=urllib.request.urlopen(r).read(); return d if raw else json.loads(d)
def kata(s): return ''.join(chr(ord(c)+96) if 'ぁ'<=c<='ゖ' else c for c in s)
def vv_wav(t,spk):
    if t in words and t not in units: q=vv('/audio_query',{'text':KANJI.get(t,t),'speaker':spk})
    else: q=vv('/audio_query',{'text':kata(t)+"'",'speaker':spk,'is_kana':'true'})
    if t in MORA:
        m=q['accent_phrases'][0]['moras'][0]; m['consonant'],m['vowel']=MORA[t]; m['consonant_length']=0.05
        q['accent_phrases']=vv('/mora_data',{'speaker':spk},q['accent_phrases'])
    if t in VLEN or t in units:
        for a in q['accent_phrases']:
            for m in a['moras']: m['vowel_length']=VLEN.get(t,max(m['vowel_length'],KANA_MIN))
    q.update(speedScale=SPEED,prePhonemeLength=0.02,postPhonemeLength=0.02,outputSamplingRate=24000,outputStereo=False)
    return vv('/synthesis',{'speaker':spk},q,raw=True)
def to_mp3(src,dst):
    """無音カット → 最後を 40ms フェード → 音量をそろえる（平均 -20dB、ピーク -1.5dB まで）"""
    e=subprocess.run([FF,'-i',src,'-af',TRIM+',volumedetect','-f','null','-'],capture_output=True,text=True).stderr
    mv=re.search(r'mean_volume: (-?[\d.]+) dB',e); mx=re.search(r'max_volume: (-?[\d.]+) dB',e)
    if not mv: raise RuntimeError('音がほとんど入っていません（MORA や VLEN で直す）')
    g=min(-20-float(mv.group(1)),-1.5-float(mx.group(1)))
    subprocess.run([FF,'-y','-loglevel','error','-i',src,'-af',f'{TRIM},areverse,afade=t=in:d=0.04,areverse,volume={g:.2f}dB','-ac','1','-ar','24000','-b:a','40k',dst],check=True)

def make_voicevox(spk):
    if not FF: sys.exit('ffmpeg が見つかりません（PATH に入れるか、環境変数 FFMPEG で場所を指定）')
    try: urllib.request.urlopen(os.environ.get('VOICEVOX_URL','http://127.0.0.1:50021')+'/version',timeout=5).read()
    except Exception as e: sys.exit(f'VOICEVOX ENGINE につながりません（{e}）。先に起動してください。')
    out={}
    with tempfile.TemporaryDirectory() as d:
        for i,t in enumerate(todo):
            w=os.path.join(d,f'{i}.wav'); m=os.path.join(d,f'{i}.mp3')
            open(w,'wb').write(vv_wav(t,spk))
            try: to_mp3(w,m)
            except RuntimeError as e: sys.exit(f'{t}: {e}')
            out[t]=open(m,'rb').read()
    return out

# ───── edge-tts（前のやり方） ─────
def make_edge(voice):
    import asyncio,edge_tts
    out={}
    async def one(t):
        b=b''
        async for ch in edge_tts.Communicate(t,voice,rate='-15%').stream():
            if ch['type']=='audio': b+=ch['data']
        if FF:
            b=subprocess.run([FF,'-loglevel','error','-i','pipe:0','-af',TRIM,'-ar','24000','-ac','1','-b:a','40k','-f','mp3','pipe:1'],input=b,capture_output=True).stdout or b
        out[t]=b
    async def main():
        sem=asyncio.Semaphore(4)
        async def g(t):
            async with sem: await one(t)
        await asyncio.gather(*[g(t) for t in todo])
    asyncio.run(main())
    return out

clips=make_voicevox(int(VOICE.split(':')[1] if ':' in VOICE else 11)) if VOICE.startswith('voicevox') else make_edge(VOICE)
voice={t:old[t] for t in texts if t in old}
voice.update({t:'data:audio/mpeg;base64,'+base64.b64encode(b).decode() for t,b in clips.items()})
voice={t:voice[t] for t in sorted(voice)}
new='const VOICE='+json.dumps(voice,ensure_ascii=False)+';'
html,n=re.subn(r'const VOICE=\{.*?\};(?=\s*\n)',lambda m:new,html,count=1,flags=re.S)
assert n==1
open(P,'w',encoding='utf8').write(html)
print('embedded',len(clips),'new /',len(voice),'clips,',os.path.getsize(P)//1024,'KB')
