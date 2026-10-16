import { describe, expect, it } from 'vitest'
import { checkDisplayName, isOffensive } from '../src/names'

const reason = (name: string) => {
  const v = checkDisplayName(name)
  return v.ok ? 'ok' : v.reason
}

describe('display names', () => {
  it('accepts ordinary names, in any language', () => {
    for (const name of ['alex', 'Ayşe', 'Çağlar', 'İbrahim', 'Mehmet.K', 'can_kiraz', 'Anna-Lena', 'User123', 'Zoë', 'Åsa']) {
      expect(reason(name), name).toBe('ok')
    }
  })

  it('accepts a wide sample of common Turkish and English first names and surnames', () => {
    const names = [
      'Ahmet', 'Mehmet', 'Mustafa', 'Ali', 'Veli', 'Ayşe', 'Fatma', 'Zeynep', 'Elif', 'Emre', 'Burak', 'Can', 'Cem', 'Deniz', 'Ece',
      'Esra', 'Gökhan', 'Gül', 'Hakan', 'Hasan', 'Hüseyin', 'İlker', 'Kemal', 'Murat', 'Okan', 'Ozan', 'Selin', 'Sevgi', 'Serkan',
      'Tolga', 'Umut', 'Yusuf', 'Pınar', 'Sıla', 'Taşkın', 'Nazlı', 'Nazım', 'Sibel', 'Sikke', 'Bokhan', 'Gotürk', 'Yarkın', 'Amasya',
      'Michael', 'James', 'Jennifer', 'Cassie', 'Massimo', 'Bassam', 'Sasha', 'Hassan', 'Assad', 'Cockburn', 'Dickinson', 'Wilcox',
      'Matthew', 'Shiloh', 'Kitty', 'Analytics', 'Pass', 'Classic', 'Mikasa', 'Okaay', 'Tuna', 'Nihan'
    ]
    const refused = names.filter(n => reason(n) !== 'ok')
    expect(refused).toEqual([])
  })

  it('does not refuse real names and words that merely contain a short stem (the "Scunthorpe problem")', () => {
    for (const name of [
      'Scunthorpe', 'Dickens', 'Dickson', 'Slutsky', 'Nazife', 'Nazire', 'Naziye', 'Hancock', 'Peacock', 'Grape', 'Drape',
      'Cassandra', 'Assistant', 'Amina', 'Sikander', 'Bokeh', 'Shakespeare', 'Essex', 'Gotham', 'Tasarim', 'Ibrahim', 'Ahmet'
    ]) {
      expect(reason(name), name).toBe('ok')
    }
  })

  it('refuses profanity and slurs in English and Turkish', () => {
    for (const name of ['fuckyou', 'BitchPlease', 'asshole1', 'Orospu', 'oruspu_cocugu', 'yarrak', 'siktir', 'Amcik', 'pezevenk', 'nigga', 'Hitler']) {
      expect(reason(name), name).toBe('blocked')
    }
  })

  it('sees through the usual disguises', () => {
    for (const name of ['F.u.c.k', 'f_u_c_k', 'fuuuuck', 'S1KT1R', 'sıktır'.replace('ı', 'i'), 'ŞİKTİR', 'h1tler', 'b1tch', 'p3zevenk', 'ORUSPU', 'o.r.o.s.p.u']) {
      expect(reason(name), name).toBe('blocked')
    }
  })

  it('refuses short stems only as a whole name or a whole part of it', () => {
    for (const name of ['AMK', 'amk123', 'a.m.k', 'xx_cunt_xx', 'Nazi', 'nazi-boy', 'Slut', 'ass.man', 'Dick', 'bok', 'Aq']) {
      expect(reason(name), name).toBe('blocked')
    }
  })

  it('reserves names that could pass for the service', () => {
    for (const name of ['admin', 'ADMIN', 'Support', 'cinema.track', 'Cinematrack', 'dizi_track', 'root', 'M0derator']) {
      expect(reason(name), name).toBe('reserved')
    }
    expect(reason('administrator_fan'), 'a name that merely starts with one is fine').toBe('ok')
  })

  it('takes Turkish letters, and still catches profanity written with them', () => {
    for (const name of ['Çağlar', 'Şebnem', 'Ümit', 'Göksel', 'İpek', 'Işık', 'Ömer_K']) expect(reason(name), name).toBe('ok')
    for (const name of ['ŞİKTİR', 'götveren', 'taşak', 'orospu_çocuğu', 'AMINA_KOYİM']) expect(reason(name), name).toBe('blocked')
  })

  it('only takes Latin letters (the word list cannot read other scripts)', () => {
    for (const name of ['Дмитрий', '李雷', 'محمد']) expect(reason(name), name).toBe('format')
  })

  it('checks the format first', () => {
    for (const name of ['a', 'x'.repeat(21), 'has space', 'bad!', 'emoji😀', '']) {
      expect(reason(name), name).toBe('format')
    }
    expect(checkDisplayName(42)).toEqual({ ok: false, reason: 'format' })
    expect(checkDisplayName(undefined)).toEqual({ ok: false, reason: 'format' })
  })

  it('trims surrounding spaces', () => {
    expect(checkDisplayName('  alex  ')).toEqual({ ok: true })
  })

  it('isOffensive can be used on its own (for text inside prompts)', () => {
    expect(isOffensive('hello fuck')).toBe(true)
    expect(isOffensive('hello world')).toBe(false)
  })
})
