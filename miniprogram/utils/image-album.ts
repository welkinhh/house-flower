function toast(message: string): void {
  wx.showToast({ title: message, icon: 'none' })
}

export function saveImageToAlbum(path: string, successMessage = '图片已保存'): void {
  if (!path) return

  const save = (filePath: string) => wx.saveImageToPhotosAlbum({
    filePath,
    success: () => wx.showToast({ title: successMessage, icon: 'success' }),
    fail: () => toast('保存未完成，请检查相册权限'),
  })

  if (/^https?:\/\//i.test(path)) {
    wx.downloadFile({
      url: path,
      success: (result) => result.statusCode === 200 ? save(result.tempFilePath) : toast('图片下载失败'),
      fail: () => toast('图片下载失败'),
    })
    return
  }

  if (path.indexOf('/assets/') === 0) {
    wx.getImageInfo({
      src: path,
      success: (result) => save(result.path),
      fail: () => toast('图片读取失败，请重试'),
    })
    return
  }

  save(path)
}
