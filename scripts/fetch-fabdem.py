"""Descarga solo el tile S27W059 de FABDEM v1-2 desde el zip de 10x10 grados (2,1 GB) de la
Universidad de Bristol, usando pedidos HTTP por rangos: se bajan ~14 MB en vez del zip completo.

Uso:  python scripts/fetch-fabdem.py
Salida: data-raw/S27W059_FABDEM_V1-2.tif

FABDEM: Hawker et al. (2022), Univ. of Bristol / Fathom. Licencia CC BY-NC-SA 4.0 (uso no comercial).
El servidor es lento (~40 KB/s): puede tardar unos 7 minutos.
"""
import io
import urllib.request
import zipfile

URL = 'https://data.bris.ac.uk/datasets/s5hqmjcdj8yo2ibzi9b4ew3sn/S30W060-S20W050_FABDEM_V1-2.zip'
MEMBER = 'S27W059_FABDEM_V1-2.tif'
OUT = 'data-raw/' + MEMBER


class HttpRangeFile(io.RawIOBase):
    """Archivo remoto de solo lectura que se lee por rangos (Range: bytes=a-b)."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        head = urllib.request.urlopen(urllib.request.Request(url, method='HEAD'))
        self.size = int(head.headers['Content-Length'])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def readinto(self, buf):
        if self.pos >= self.size or not len(buf):
            return 0
        end = min(self.pos + len(buf), self.size) - 1
        req = urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{end}'})
        data = urllib.request.urlopen(req).read()
        buf[: len(data)] = data
        self.pos += len(data)
        return len(data)


if __name__ == '__main__':
    z = zipfile.ZipFile(io.BufferedReader(HttpRangeFile(URL), buffer_size=1 << 20))
    with open(OUT, 'wb') as f:
        f.write(z.read(MEMBER))
    print('listo:', OUT)
