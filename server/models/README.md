# Models

- `face_detection_yunet_2023mar.onnx` — YuNet face detector from the
  [OpenCV model zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
  (MIT license). Used by `src/faceDetect.js` for photos PhotoPrism has no
  face markers for.
- `object_detection_nanodet_2022nov.onnx` — NanoDet-Plus (COCO, 80 classes)
  from the [OpenCV model zoo](https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_nanodet)
  (Apache-2.0). Used by `src/photoAnalysis.js` to find people (also seen
  from behind) and other subjects.
