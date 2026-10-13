# Models

- `face_detection_yunet_2023mar.onnx` — YuNet face detector, © 2020 Shiqi Yu,
  from the
  [OpenCV model zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
  ([MIT license](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE)).
  Used by `src/faceDetect.js` for photos PhotoPrism has no face markers for.
- `object_detection_nanodet_2022nov.onnx` — NanoDet-Plus (COCO, 80 classes),
  originally from [RangiLyu/nanodet](https://github.com/RangiLyu/nanodet),
  converted to ONNX by the
  [OpenCV model zoo](https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_nanodet)
  ([Apache License 2.0](https://github.com/opencv/opencv_zoo/blob/main/models/object_detection_nanodet/LICENSE)).
  Used by `src/photoAnalysis.js` to find people (also seen from behind) and
  other subjects.
