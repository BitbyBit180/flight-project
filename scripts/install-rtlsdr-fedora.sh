#!/usr/bin/env bash
# Install the rtl-sdr-blog driver fork on Fedora and blacklist the stock DVB-T
# kernel modules so the RTL-SDR Blog V4 works for ADS-B. Idempotent.
set -euo pipefail

SRC="${SRC:-/tmp/rtl-sdr-blog}"

echo "==> Installing build dependencies"
sudo dnf install -y git cmake make gcc libusb1-devel pkgconf-pkg-config

echo "==> Building rtl-sdr-blog fork"
rm -rf "$SRC"
git clone --depth 1 https://github.com/rtlsdrblog/rtl-sdr-blog "$SRC"
cmake -S "$SRC" -B "$SRC/build" -DINSTALL_UDEV_RULES=ON -DDETACH_KERNEL_DRIVER=ON
make -C "$SRC/build" -j"$(nproc)"
sudo make -C "$SRC/build" install
sudo ldconfig

echo "==> Blacklisting stock DVB-T modules (the #1 'it doesn't work' cause)"
sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf >/dev/null <<'EOF'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
blacklist rtl2838
blacklist dvb_usb_v2
EOF

echo "==> Reloading udev + unloading any active DVB-T driver"
sudo udevadm control --reload-rules && sudo udevadm trigger
sudo modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true

echo
echo "Done. Unplug & replug the RTL-SDR, then verify with:"
echo "    rtl_test -t"
